import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attack } from "@/lib/agent/run";
import { createContext } from "@/lib/agent/context";
import { makeDeps } from "@/lib/agent/setup";
import { CONFIRM_HITS, confirmHits } from "@/lib/agent/stages";
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
    // Only the re-attack sends a batch this large: there every program times out, so nothing can be judged.
    const executor: Executor = {
      name: d.executor.name,
      label: d.executor.label,
      async run(req: RunRequest) {
        if (req.inputs.length <= 100) return d.executor.run(req);
        return { outcomes: req.inputs.map(() => ({ ok: false as const, error: "timeout" as const, message: "time limit exceeded" })), wallMs: 0, processes: 1 };
      },
    };
    const r = await attack({ problem: coins.problem, solution: coins.demo, research: "off" }, { ...d, executor });
    expect(r.verdict).toBe("counterexample");
    expect(r.fix?.verified).toBe(false);
    expect(r.fix?.reattackUnjudged).toBe(r.fix?.reattackInputs);
    expect(r.trace.some((e) => /could not judge the counterexample itself, so it is not verified/.test(e.msg))).toBe(true);
  });

  it("reserves only what shrinking needs, so a tight run budget still covers a full attack", async () => {
    const full = await attack({ problem: bs.problem, solution: correct, research: "off" }, deps());
    expect(full.verdict).toBe("no_counterexample");
    const shrinkReserve = 2 * (2_000 + CONFIRM_HITS + 1);
    const r = await attack({ problem: bs.problem, solution: correct, research: "off" }, { ...deps(), budgets: { maxRuns: full.stats.runs + shrinkReserve } });
    expect(r.verdict).toBe("no_counterexample");
    expect(r.stats.inputsTested).toBe(full.stats.inputsTested);
  });
});
