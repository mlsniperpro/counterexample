import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attack } from "@/lib/agent/run";
import { createContext } from "@/lib/agent/context";
import { makeDeps } from "@/lib/agent/setup";
import { CONFIRM_HITS, confirmHits, RUN_CHUNK, shrinkStage } from "@/lib/agent/stages";
import type { TraceEvent } from "@/lib/agent/trace";
import { FIXTURES } from "@/fixtures/replay";
import type { Executor, RunRequest } from "@/lib/exec/types";
import type { ReplayFixtures } from "@/lib/models/replay";
import { BUILT_INS } from "@/lib/problems/catalog";

const env = { NODE_ENV: "test" };
const deps = (fixtures?: ReplayFixtures) => makeDeps({ mode: "replay", env, fixtures });
const bs = BUILT_INS.find((b) => b.problem.id === "binary-search")!;
// Its first hit, [[8, 9], 16], takes several shrink steps (binary search's is already minimal).
const coins = BUILT_INS.find((b) => b.problem.id === "coin-change")!;
const correct = { language: "python" as const, code: readFileSync(join(__dirname, "../../bench/solutions/binary-search/correct.py"), "utf8"), entry: "solve" };

/** Wraps an executor and turns the first outcome of the first `times` solution runs into a spurious timeout (an overloaded sandbox). */
function flaky(inner: Executor, code: string, times: number): Executor {
  let left = times;
  return {
    name: inner.name,
    label: inner.label,
    async run(req: RunRequest) {
      const res = await inner.run(req);
      if (req.code !== code || left <= 0 || res.outcomes.length === 0) return res;
      left--;
      return { ...res, outcomes: [{ ok: false, error: "timeout", message: "time limit exceeded" }, ...res.outcomes.slice(1)] };
    },
  };
}

describe("a mismatch must reproduce before a bug is claimed", () => {
  it("drops a one-off spurious timeout on a correct solution instead of reporting a false alarm", async () => {
    const d = deps();
    const r = await attack({ problem: bs.problem, solution: correct, research: "off" }, { ...d, executor: flaky(d.executor, correct.code, 1) });
    expect(r.verdict).toBe("no_counterexample");
    expect(r.counterexample).toBeUndefined();
    expect(r.trace.some((e) => e.kind === "warn" && /did not reproduce/.test(e.msg))).toBe(true);
    expect(r.message).toMatch(/families\. 1 mismatch\(es\) did not reproduce on a re-run and were dropped\. That is evidence, not proof\.$/);
    expect(r.stats.modelCalls).toBe(2);
  });

  it("still finds the real bug when a spurious timeout hits a buggy solution", async () => {
    const d = deps();
    const r = await attack({ problem: bs.problem, solution: bs.demo, research: "off" }, { ...d, executor: flaky(d.executor, bs.demo.code, 1) });
    expect(r.verdict).toBe("counterexample");
    expect(r.counterexample?.got).not.toMatch(/^timeout/);
    expect(r.fix?.verified).toBe(true);
  });

  it("keeps the confirmed counterexample when the wall clock runs out during shrinking", async () => {
    let now = 0;
    let jumped = false;
    const onEvent = (e: TraceEvent) => {
      if (e.stage === "shrink" && !jumped) {
        jumped = true;
        now += 10 * 60_000;
      }
    };
    const r = await attack({ problem: coins.problem, solution: coins.demo, research: "off" }, { ...deps(), clock: () => (now += 1), onEvent });
    expect(jumped).toBe(true);
    expect(r.verdict).toBe("counterexample");
    expect(r.counterexample).toBeDefined();
    expect(r.counterexample?.shrinkExhausted).toBe(true);
    expect(r.message).toMatch(/^Found a counterexample, then budget exhausted: wallClock/);
  });

  it("marks a counterexample whose shrink ran out of evaluations as possibly not minimal", async () => {
    const r = await attack({ problem: coins.problem, solution: coins.demo, research: "off" }, { ...deps(), budgets: { maxShrinkEvals: 8 } });
    expect(r.verdict).toBe("counterexample");
    expect(r.counterexample?.shrinkExhausted).toBe(true);
    expect(r.message).toMatch(/may not be minimal/);
    expect(r.trace.some((e) => /shrink budget exhausted/.test(e.msg))).toBe(true);
  });

  it("calls a fully shrunk counterexample minimal", async () => {
    const r = await attack({ problem: coins.problem, solution: coins.demo, research: "off" }, deps());
    expect(r.counterexample?.shrinkSteps).toBeGreaterThan(0);
    expect(r.counterexample?.shrinkExhausted).toBe(false);
    expect(r.message).not.toMatch(/may not be minimal/);
  });
});

describe("shrinking when the minimal input does not fail again", () => {
  it("says so, not that the shrink budget ran out, and reports the confirmed original", async () => {
    // A flaky solution: wrong for x >= 10, but only the first time it sees an input.
    const solution = { language: "python" as const, code: "def solve(x):\n    return x  # under test\n", entry: "solve" };
    const oracle = "def solve(x):\n    return x\n";
    const seen = new Set<number>();
    const executor: Executor = {
      name: "fake",
      label: "fake",
      async run(req: RunRequest) {
        const outcomes = req.inputs.map(([x]) => {
          const n = x as number;
          if (req.code === oracle) return { ok: true as const, out: n, ms: 0 };
          const first = !seen.has(n);
          seen.add(n);
          return { ok: true as const, out: n >= 10 && first ? -1 : n, ms: 0 };
        });
        return { outcomes, wallMs: 0, processes: 1 };
      },
    };
    const problem = { ...bs.problem, params: [{ name: "x", type: { kind: "int" as const, min: 0, max: 100_000 } }], examples: [] };
    const events: TraceEvent[] = [];
    const ctx = createContext({ problem, solution, research: "off" }, { ...deps(), executor, onEvent: (e) => events.push(e) });
    ctx.judge.oracleCode = oracle;
    const hit = { args: [5000], family: "f", confirmed: true, j: { status: "mismatch" as const, expected: 5000, got: "-1" } };
    const cx = await shrinkStage(ctx, [hit]);
    expect(cx.args).toEqual([5000]);
    expect(cx.shrinkSteps).toBe(0);
    expect(cx.shrinkEvals).toBeGreaterThan(0);
    // Still "may not be minimal", so the flag stays true.
    expect(cx.shrinkExhausted).toBe(true);
    const shown = events.find((e) => e.kind === "counterexample");
    expect(shown?.msg).toMatch(/^Counterexample \(the shrunk input did not fail again; the confirmed original is shown\): solve\(5000\)/);
    expect(events.some((e) => /budget exhausted/.test(e.msg))).toBe(false);
    expect(ctx.report.message).toMatch(/did not fail again, so the confirmed original is shown and it may not be minimal/);
    expect(ctx.report.message).not.toMatch(/Shrinking stopped early/);
  });
});

describe("oracle answers without code", () => {
  it("retries with feedback instead of ending the attack", async () => {
    const oracle = FIXTURES["binary-search"]?.oracle;
    const good = Array.isArray(oracle) ? oracle[0] : oracle;
    expect(good).toBeDefined();
    const fx: ReplayFixtures = { ...FIXTURES, "binary-search": { ...FIXTURES["binary-search"], oracle: ["I would scan the list linearly.", good!] } };
    const r = await attack({ problem: bs.problem, solution: bs.demo, research: "off" }, deps(fx));
    expect(r.verdict).toBe("counterexample");
    expect(r.oracle?.attempts).toBe(2);
    expect(r.trace.some((e) => e.kind === "warn" && /no code block on attempt 1/.test(e.msg))).toBe(true);
  });

  it("gives up as oracle_unreliable (no bug claimed) when no attempt has code", async () => {
    const fx: ReplayFixtures = { ...FIXTURES, "binary-search": { ...FIXTURES["binary-search"], oracle: ["no code", "still no code", "never"] } };
    const r = await attack({ problem: bs.problem, solution: bs.demo, research: "off" }, deps(fx));
    expect(r.verdict).toBe("oracle_unreliable");
    expect(r.counterexample).toBeUndefined();
  });
});

describe("benchmark ablations", () => {
  it("no-model keeps every family except the model-designed ones, and makes no generator call", async () => {
    const r = await attack({ problem: coins.problem, solution: coins.demo, research: "off", generators: "no-model" }, deps());
    const sources = new Set(r.families.map((f) => f.source));
    expect(sources).toEqual(new Set(["examples", "exhaustive", "mutation", "baseline"]));
    expect(r.stages.some((c) => c.purpose === "generators")).toBe(false);
  });

  it("baseline-only runs just the examples and random inputs", async () => {
    const r = await attack({ problem: coins.problem, solution: coins.demo, research: "off", generators: "baseline-only" }, deps());
    expect(new Set(r.families.map((f) => f.source))).toEqual(new Set(["examples", "baseline"]));
  });
});

describe("confirming hits", () => {
  it("keeps re-checking past a batch of flaky hits until a real one reproduces, and counts every dropped hit", async () => {
    const solution = { language: "python" as const, code: "def solve(x):\n    return -1 if x == 12345 else x\n", entry: "solve" };
    const executor: Executor = {
      name: "fake",
      label: "fake",
      async run(req: RunRequest) {
        const outcomes = req.inputs.map(([x]) => {
          const n = x as number;
          // The oracle is the identity; the solution is wrong only at 12345.
          return { ok: true as const, out: req.code === solution.code && n === 12345 ? -1 : n, ms: 0 };
        });
        return { outcomes, wallMs: 0, processes: 1 };
      },
    };
    const problem = { ...bs.problem, params: [{ name: "x", type: { kind: "int" as const, min: 0, max: 100_000 } }], examples: [] };
    const events: TraceEvent[] = [];
    const ctx = createContext({ problem, solution, research: "off" }, { ...deps(), executor, onEvent: (e) => events.push(e) });
    ctx.judge.oracleCode = "def solve(x):\n    return x\n";
    // Sightings from an overloaded sandbox: 1 to 5 timed out spuriously (they pass on a re-run), 12345 is a real bug.
    const found = [1, 2, 3, 4, 5, 12345].map((x) => ({ args: [x], family: "f", confirmed: false, j: { status: "mismatch" as const, expected: x, got: "timeout" } }));
    const kept = await confirmHits(ctx, found);
    expect(kept.map((h) => h.args)).toEqual([[12345]]);
    expect(kept[0]?.confirmed).toBe(true);
    expect(events.some((e) => e.kind === "warn" && /^5 mismatch\(es\) did not reproduce/.test(e.msg))).toBe(true);
  });

  it("does not call a fix verified when the oracle could judge none of the re-attack", async () => {
    const d = deps();
    // The third program to run is the proposed fix, so the re-attack starts there: from then on every program times out, and nothing can be judged.
    const programs = new Set<string>();
    let reattack = false;
    const executor: Executor = {
      name: d.executor.name,
      label: d.executor.label,
      async run(req: RunRequest) {
        programs.add(req.code);
        if (programs.size >= 3) reattack = true;
        if (!reattack) return d.executor.run(req);
        return { outcomes: req.inputs.map(() => ({ ok: false as const, error: "timeout" as const, message: "time limit exceeded" })), wallMs: 0, processes: 1 };
      },
    };
    const r = await attack({ problem: coins.problem, solution: coins.demo, research: "off" }, { ...d, executor });
    expect(r.verdict).toBe("counterexample");
    expect(r.fix?.verified).toBe(false);
    expect(r.fix?.reattackUnjudged).toBe(r.fix?.reattackInputs);
    expect(r.trace.some((e) => /could not judge the counterexample itself, so it is not verified/.test(e.msg))).toBe(true);
  });

  it("keeps the proposed fix, not verified, when the wall clock runs out during its re-attack", async () => {
    let now = 0;
    let jumped = false;
    const onEvent = (e: TraceEvent) => {
      // After the first re-attack chunk has been sent: the next one finds the clock past the budget.
      if (e.stage === "reattack" && e.kind === "exec" && !jumped) {
        jumped = true;
        now += 10 * 60_000;
      }
    };
    const r = await attack({ problem: bs.problem, solution: bs.demo, research: "off" }, { ...deps(), clock: () => (now += 1), onEvent });
    expect(jumped).toBe(true);
    expect(r.verdict).toBe("counterexample");
    expect(r.fix).toMatchObject({ verified: false, attempts: 1, reattackInputs: RUN_CHUNK, reattackMismatches: 0, reattackUnjudged: 0 });
    expect(r.fix?.code).toMatch(/def solve/);
    expect(r.message).toMatch(/^Found a counterexample, then budget exhausted: wallClock.*\(during reattack\)\. The proposed fix was not verified in time$/);
  });

  it("stops re-attacking at the first chunk with a mismatch, so a fix that fails the counterexample is cheap", async () => {
    const budgets = { maxFixAttempts: 1 };
    const full = await attack({ problem: bs.problem, solution: bs.demo, research: "off" }, { ...deps(), budgets });
    expect(full.fix?.verified).toBe(true);
    expect(full.fix!.reattackInputs).toBeGreaterThan(4 * RUN_CHUNK);
    // The "fix" is the buggy code again, so it fails the counterexample, which is judged in the first chunk.
    const same: ReplayFixtures = { ...FIXTURES, "binary-search": { ...FIXTURES["binary-search"], explain: "EXPLANATION: Nothing to change.\n\n```python\n" + bs.demo.code + "\n```" } };
    const r = await attack({ problem: bs.problem, solution: bs.demo, research: "off" }, { ...deps(same), budgets });
    expect(r.verdict).toBe("counterexample");
    expect(r.fix?.verified).toBe(false);
    expect(r.fix?.reattackInputs).toBe(RUN_CHUNK);
    expect(r.fix?.reattackMismatches).toBeGreaterThan(0);
    const fixRuns = r.trace.filter((e) => e.stage === "reattack" && e.kind === "exec" && e.data?.who === "fix").reduce((n, e) => n + (e.data?.inputs as number), 0);
    expect(fixRuns).toBe(RUN_CHUNK);
    expect(full.stats.runs - r.stats.runs).toBe(2 * (full.fix!.reattackInputs - RUN_CHUNK));
    expect(r.trace.some((e) => e.kind === "warn" && /^Fix still fails on \d+ input\(s\)$/.test(e.msg))).toBe(true);
  });

  it("reserves only what shrinking needs, so a tight run budget still covers a full attack", async () => {
    const full = await attack({ problem: bs.problem, solution: correct, research: "off" }, deps());
    expect(full.verdict).toBe("no_counterexample");
    expect(full.message).not.toMatch(/did not reproduce/);
    const shrinkReserve = 2 * (2_000 + CONFIRM_HITS + 1);
    const r = await attack({ problem: bs.problem, solution: correct, research: "off" }, { ...deps(), budgets: { maxRuns: full.stats.runs + shrinkReserve } });
    expect(r.verdict).toBe("no_counterexample");
    expect(r.stats.inputsTested).toBe(full.stats.inputsTested);
  });
});
