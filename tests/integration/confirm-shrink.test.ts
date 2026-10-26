import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attack } from "@/lib/agent/run";
import { createContext } from "@/lib/agent/context";
import { makeDeps } from "@/lib/agent/setup";
import { explainPrompt } from "@/lib/agent/prompts";
import { attackStage, CONFIRM_HITS, confirmHits, fixStage, RUN_CHUNK, shrinkStage } from "@/lib/agent/stages";
import type { TraceEvent } from "@/lib/agent/trace";
import { FIXTURES } from "@/fixtures/replay";
import type { Counterexample } from "@/lib/agent/types";
import type { Executor, RunRequest } from "@/lib/exec/types";
import type { ReplayFixtures } from "@/lib/models/replay";
import { outputsEqual } from "@/lib/core/compare";
import { BUILT_INS } from "@/lib/problems/catalog";
import type { Problem } from "@/lib/problems/types";

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

describe("a solution that keeps state between calls", () => {
  // Correct binary search, except for a memo keyed by target alone: wrong once another array has the same target.
  const stateful = {
    language: "python" as const,
    code: [
      "def solve(nums, target, _memo={}):",
      "    if target in _memo:",
      "        return _memo[target]",
      "    lo, hi, r = 0, len(nums) - 1, -1",
      "    while lo <= hi:",
      "        mid = (lo + hi) // 2",
      "        if nums[mid] == target:",
      "            r = mid",
      "            break",
      "        if nums[mid] < target:",
      "            lo = mid + 1",
      "        else:",
      "            hi = mid - 1",
      "    _memo[target] = r",
      "    return r",
      "",
    ].join("\n"),
    entry: "solve",
  };

  it("reports an order-dependent counterexample that passes alone, never a flaky one", async () => {
    const r = await attack({ problem: bs.problem, solution: stateful, research: "off" }, deps());
    expect(r.verdict).toBe("counterexample");
    const cx = r.counterexample!;
    expect(cx.orderDependent?.precedingInputs).toBeGreaterThan(0);
    expect(cx.shrinkSteps).toBe(0);
    expect(cx.shrinkEvals).toBe(0);
    expect(r.message).toBe("The solution fails on this input only after earlier calls in the same process: it keeps state between calls. Run alone, it is correct.");
    expect(r.trace.some((e) => /flaky/.test(e.msg))).toBe(false);
    expect(r.trace.some((e) => e.kind === "counterexample" && /keeps state between calls/.test(e.msg))).toBe(true);
    expect(r.trace.some((e) => e.stage === "shrink" && e.kind === "exec")).toBe(false);
    // Run alone, in a fresh process, the input passes.
    const d = deps();
    const alone = await d.executor.run({ language: "python", code: stateful.code, entry: "solve", inputs: [cx.args], timeLimitMs: 2000, memoryLimitMb: 256 });
    const oracle = await d.executor.run({ language: "python", code: r.oracle!.code, entry: "solve", inputs: [cx.args], timeLimitMs: 2000, memoryLimitMb: 256 });
    expect(alone.outcomes[0]).toMatchObject({ ok: true, out: (oracle.outcomes[0] as { out: unknown }).out });
    // The explain stage still runs, and its prompt mentions the statefulness.
    expect(r.explanation).toBeDefined();
  });

  // The identity function with a mutable default argument: it answers -1 when 8 comes right after 7 in one process. Run alone, 8 is right.
  const seen = {
    language: "python" as const,
    code: "def solve(x, _seen=[]):\n    _seen.append(x)\n    if len(_seen) >= 2 and _seen[-2] == 7 and x == 8:\n        return -1\n    return x\n",
    entry: "solve",
  };
  const identity: Problem = {
    ...bs.problem,
    id: "st",
    title: "Identity",
    statement: "Return x.",
    params: [{ name: "x", type: { kind: "int", min: 0, max: 1000 } }],
    returns: "x",
    examples: [{ args: [5], output: 5 }, { args: [1], output: 1 }],
  };
  const identityFixtures = (fixed: string): ReplayFixtures => ({
    st: { oracle: "```python\ndef solve(x):\n    return x\n```", generators: "no json here", explain: "EXPLANATION: It keeps a list between calls.\n\n```python\n" + fixed + "```" },
  });
  const attackSeen = (fixed: string) => attack({ problem: identity, solution: seen, research: "off" }, deps(identityFixtures(fixed)));

  it("does not verify a 'fix' identical to the stateful buggy code (the counterexample alone passes even for it)", async () => {
    const r = await attackSeen(seen.code);
    expect(r.verdict).toBe("counterexample");
    expect(r.counterexample?.args).toEqual([8]);
    expect(r.counterexample?.orderDependent?.precedingInputs).toBeGreaterThan(0);
    expect(r.fix?.code.trim()).toBe(seen.code.trim());
    expect(r.fix?.verified).toBe(false);
    expect(r.fix?.reattackMismatches).toBeGreaterThan(0);
    // It failed in the first chunk, which is the failing sequence itself, so nothing else was spent on it.
    const seq = r.counterexample!.orderDependent!.sequence!;
    expect(seq).toHaveLength(r.counterexample!.orderDependent!.precedingInputs + 1);
    expect(r.fix?.reattackInputs).toBe(seq.length);
    expect(r.trace.some((e) => e.stage === "reattack" && e.kind === "warn" && /^Fix still fails on \d+ input\(s\)$/.test(e.msg))).toBe(true);
  });

  it("verifies a genuinely fixed, stateless version, after running the failing sequence first", async () => {
    const r = await attackSeen("def solve(x):\n    return x\n");
    expect(r.verdict).toBe("counterexample");
    const seq = r.counterexample!.orderDependent!.sequence!;
    expect(r.fix?.verified).toBe(true);
    expect(r.fix?.reattackMismatches).toBe(0);
    const fixRuns = r.trace.filter((e) => e.stage === "reattack" && e.kind === "exec" && e.data?.who === "fix");
    expect(fixRuns[0]?.data?.inputs).toBe(seq.length);
    expect(r.fix!.reattackInputs).toBeGreaterThan(seq.length);
  });

  it("keeps the failing inputs, in order, as the counterexample's sequence, ending with the counterexample", async () => {
    const r = await attack({ problem: bs.problem, solution: stateful, research: "off" }, deps());
    const cx = r.counterexample!;
    const seq = cx.orderDependent!.sequence!;
    expect(seq.at(-1)).toEqual(cx.args);
    expect(cx.original.args).toEqual(cx.args);
    // In a fresh process, the sequence makes the stateful code fail at its last input, and only there.
    const d = deps();
    const run = (code: string) => d.executor.run({ language: "python", code, entry: "solve", inputs: seq, timeLimitMs: 2000, memoryLimitMb: 256 });
    const [mine, oracle] = [await run(stateful.code), await run(r.oracle!.code)];
    const wrong = mine.outcomes.map((o, i) => !(o.ok && outputsEqual(o.out, (oracle.outcomes[i] as { out: unknown }).out)));
    expect(wrong.at(-1)).toBe(true);
    expect(wrong.slice(0, -1).every((w) => !w)).toBe(true);
    // The trace and the report line never carry the (possibly long) sequence itself.
    expect(r.trace.some((e) => JSON.stringify(e.data ?? {}).includes('"sequence"'))).toBe(false);
  });

  it("tells the explain model about the state, and only then", () => {
    const text = (stateful: boolean) => explainPrompt(bs.problem, stateful ? bs.demo : bs.demo, [[1], 1], 0, "-1", undefined, stateful)[1]!.content;
    expect(text(true)).toMatch(/only after earlier calls in the same process/);
    expect(text(false)).not.toMatch(/earlier calls/);
  });

  it("still drops a one-off failure that does not come back in the original order", async () => {
    const solution = { language: "python" as const, code: "def solve(x):\n    return x  # under test\n", entry: "solve" };
    const oracle = "def solve(x):\n    return x\n";
    let solutionRuns = 0;
    const executor: Executor = {
      name: "fake",
      label: "fake",
      async run(req: RunRequest) {
        const isSolution = req.code === solution.code;
        if (isSolution) solutionRuns++;
        // Only the very first run of the solution (the original chunk) is wrong, and only at its third input.
        const outcomes = req.inputs.map(([x], i) => ({ ok: true as const, out: isSolution && solutionRuns === 1 && i === 2 ? -1 : (x as number), ms: 0 }));
        return { outcomes, wallMs: 0, processes: 1 };
      },
    };
    const problem = { ...bs.problem, params: [{ name: "x", type: { kind: "int" as const, min: 0, max: 100 } }], examples: [] };
    const ctx = createContext({ problem, solution, research: "off" }, { ...deps(), executor });
    ctx.judge.oracleCode = oracle;
    const chunk = [[10], [11], [12], [13]];
    const found = [{ args: chunk[2] as unknown[], family: "f", confirmed: false, j: { status: "mismatch" as const, expected: 12, got: "-1" } }];
    expect(await confirmHits(ctx, found, chunk)).toEqual([]);
    expect(ctx.droppedMismatches).toBe(1);
  });
});

describe("the small-scope family says when it was cut", () => {
  it("names how many of the small inputs it kept, and traces the sampling", async () => {
    const r = await attack({ problem: bs.problem, solution: correct, research: "off" }, deps());
    const small = r.families.find((f) => f.name === "small-scope")!;
    expect(small.rationale).toBe("300 of 371 small inputs of the declared types, sampled evenly (bounded exhaustive testing: most bugs have a small counterexample).");
    expect(small.rationale).not.toMatch(/^Every/);
    expect(r.trace.some((e) => e.stage === "attack" && e.kind === "info" && /small-scope: 300 of 371 small inputs kept, sampled evenly/.test(e.msg))).toBe(true);
  });

  it("still says every small input when nothing was cut", async () => {
    const isqrt = BUILT_INS.find((b) => b.problem.id === "isqrt");
    if (!isqrt) throw new Error("isqrt is not a built-in");
    const r = await attack({ problem: isqrt.problem, solution: isqrt.demo, research: "off", generators: "no-model" }, deps());
    expect(r.families.find((f) => f.name === "small-scope")!.rationale).toMatch(/^Every small input/);
    expect(r.trace.some((e) => /sampled evenly/.test(e.msg))).toBe(false);
  });
});

describe("re-attacking a fix on an order-dependent counterexample", () => {
  const problem = { ...bs.problem, id: "seq", params: [{ name: "x", type: { kind: "int" as const, min: 0, max: 100 } }], examples: [{ args: [3], output: 3 }] };
  const solution = { language: "python" as const, code: "def solve(x):\n    return x  # buggy, stateful\n", entry: "solve" };
  const fixCode = "def solve(x):\n    return x  # the fix\n";
  const fixtures: ReplayFixtures = { seq: { explain: "EXPLANATION: Changed.\n\n```python\n" + fixCode + "```", oracle: "x", generators: "x" } };
  /** The failing sequence: a repeat, and the counterexample last. */
  const sequence = [[1], [7], [7], [8]];
  const cx: Counterexample = { args: [8], expected: 8, got: "-1", original: { args: [8], family: "f" }, shrinkSteps: 0, shrinkEvals: 0, shrinkExhausted: true, orderDependent: { precedingInputs: 3, sequence } };

  /** Fix runs are recorded; the fix answers x, except -1 where `failAt(inputs, i)` says input i of that run is the bad one. One fix attempt. */
  function setup(failAt: (inputs: unknown[][], i: number) => boolean, budgets: Partial<Parameters<typeof createContext>[1]["budgets"]> = {}) {
    const fixRuns: unknown[][][] = [];
    const executor: Executor = {
      name: "fake",
      label: "fake",
      async run(req: RunRequest) {
        const isFix = req.code === fixCode;
        if (isFix) fixRuns.push(req.inputs);
        const outcomes = req.inputs.map(([x], i) => ({ ok: true as const, out: isFix && failAt(req.inputs, i) ? -1 : (x as number), ms: 0 }));
        return { outcomes, wallMs: 0, processes: 1 };
      },
    };
    const ctx = createContext({ problem, solution, research: "off" }, { ...deps(fixtures), executor, budgets: { maxFixAttempts: 1, ...budgets } });
    ctx.judge.oracleCode = "def solve(x):\n    return x\n";
    return { ctx, fixRuns };
  }
  const tested = [[2], [7], [8], [1]];

  it("starts with the exact failing sequence, repeats and order kept, in one chunk, then the rest without repeating it", async () => {
    const { ctx, fixRuns } = setup(() => false);
    await fixStage(ctx, cx, [], tested);
    expect(fixRuns[0]).toEqual(sequence);
    expect(fixRuns.length).toBe(2);
    const rest = fixRuns.slice(1).flat();
    expect(rest).toEqual([[2], [3]]);
    expect(ctx.report.fix).toMatchObject({ verified: true, reattackInputs: 6, reattackMismatches: 0 });
  });

  it("judges the counterexample at its place in the sequence: failing there is not verified, though it passes alone", async () => {
    // The fix is wrong on the last input of the first chunk only when run after the others (state).
    const { ctx, fixRuns } = setup((inputs, i) => inputs.length === sequence.length && i === inputs.length - 1);
    await fixStage(ctx, cx, [], tested);
    expect(fixRuns).toEqual([sequence]);
    expect(ctx.report.fix).toMatchObject({ verified: false, reattackInputs: 4, reattackMismatches: 1 });
    expect(ctx.tracer.events.some((e) => e.kind === "warn" && e.msg === "Fix still fails on 1 input(s)")).toBe(true);
  });

  it("is not verified when the run budget ends inside the sequence (the counterexample was never judged)", async () => {
    const { ctx } = setup(() => false, { maxRuns: 7 });
    ctx.budget.useRuns(0);
    await fixStage(ctx, cx, [], tested);
    expect(ctx.report.fix?.verified).toBe(false);
    expect(ctx.tracer.events.some((e) => e.kind === "warn" && /the run budget ran out after 3 of 6 inputs, so it is not verified$/.test(e.msg))).toBe(true);
  });

  it("is not verified when the order the counterexample failed in was not recorded", async () => {
    const { ctx, fixRuns } = setup(() => false);
    await fixStage(ctx, { ...cx, orderDependent: { precedingInputs: 3 } }, [], tested);
    expect(fixRuns.flat()).toEqual([[8], [2], [7], [1], [3]]);
    expect(ctx.report.fix?.verified).toBe(false);
    expect(ctx.tracer.events.some((e) => e.kind === "warn" && /the order in which the counterexample failed was not recorded, so it is not verified$/.test(e.msg))).toBe(true);
  });

  it("re-attacks an ordinary counterexample as before: it first, then the rest", async () => {
    const { ctx, fixRuns } = setup(() => false);
    const plain: Counterexample = { ...cx };
    delete plain.orderDependent;
    await fixStage(ctx, plain, [], tested);
    expect(fixRuns.flat()).toEqual([[8], [2], [7], [1], [3]]);
    expect(ctx.report.fix?.verified).toBe(true);
  });
});

describe("the small-scope family's text matches what it holds", () => {
  const solution = { language: "python" as const, code: "def solve(*a):\n    return 0\n", entry: "solve" };
  const problemOf = (params: Problem["params"]): Problem => ({ ...bs.problem, id: "sc", params, examples: [] });
  const familyOf = async (params: Problem["params"]) => {
    const ctx = createContext({ problem: problemOf(params), solution, research: "off", generators: "no-model" }, deps());
    const plan = await attackStage(ctx, []);
    return { family: plan.find((f) => f.name === "small-scope")!, trace: ctx.tracer.events };
  };
  const arr = { kind: "array" as const, of: { kind: "int" as const, min: -100, max: 100 }, len: { min: 0, max: 5 } };

  it("does not claim a count for a space it only sampled, and says it spans all of it", async () => {
    const { family, trace } = await familyOf([
      { name: "a", type: arr },
      { name: "b", type: arr },
      { name: "c", type: { kind: "int", min: 0, max: 100 } },
    ]);
    expect(family.rationale).toBe("300 of 43200 combinations of small values of the declared types, sampled evenly across all of them (bounded exhaustive testing: most bugs have a small counterexample).");
    expect(family.rationale).not.toMatch(/at least|prefix|^Every/);
    expect(trace.some((e) => e.kind === "info" && /small-scope: 300 kept of 43200 combinations of small values, sampled by stride across all of them/.test(e.msg))).toBe(true);
  });

  it("says so when the family ends with no inputs, instead of 'every small input'", async () => {
    const { family, trace } = await familyOf([{ name: "g", type: { kind: "graph", n: { min: 9, max: 20 }, m: { min: 0, max: 5 }, weight: { min: 0, max: 5 } } }]);
    expect(family.rationale).toMatch(/^No small input of the declared types exists.*this family is empty/);
    expect(family.rationale).not.toMatch(/^Every/);
    expect(trace.some((e) => e.kind === "warn" && /small-scope: no small input fits the declared types; the family is empty/.test(e.msg))).toBe(true);
  });

  it("tells when a graph with no small instance is held at its smallest valid graph, and still keeps the other parameters' inputs", async () => {
    const { family, trace } = await familyOf([
      { name: "g", type: { kind: "graph", n: { min: 9, max: 20 }, m: { min: 0, max: 5 }, weight: { min: 0, max: 5 } } },
      { name: "k", type: { kind: "int", min: 0, max: 3 } },
    ]);
    expect(family.rationale).toBe("Every small input of the declared types (bounded exhaustive testing: most bugs have a small counterexample). A graph with no small instance is held at its smallest valid graph.");
    expect(trace.some((e) => e.kind === "info" && /a graph parameter has no small instance, so its smallest valid graph stands in/.test(e.msg))).toBe(true);
  });
});

describe("the explanation and the fix in a report belong to the same attempt", () => {
  it("drops the failed fix when the next answer has an explanation but no code", async () => {
    const same = "```python\n" + bs.demo.code + "\n```";
    const fx: ReplayFixtures = {
      ...FIXTURES,
      "binary-search": { ...FIXTURES["binary-search"], explain: [`EXPLANATION: First guess.\n\n${same}`, "EXPLANATION: Second thoughts, but I will not write code."] },
    };
    const r = await attack({ problem: bs.problem, solution: bs.demo, research: "off" }, deps(fx));
    expect(r.verdict).toBe("counterexample");
    expect(r.explanation).toBe("Second thoughts, but I will not write code.");
    // Absent, not set to undefined: the report is serialised with undefined as null.
    expect(r).not.toHaveProperty("fix");
    expect(r.trace.some((e) => e.kind === "warn" && /No fix was proposed/.test(e.msg))).toBe(true);
    // The first attempt did run and fail before it was dropped.
    expect(r.trace.some((e) => e.stage === "reattack" && /Fix still fails/.test(e.msg))).toBe(true);
  });

  it("keeps a fix that comes with its own explanation", async () => {
    const r = await attack({ problem: bs.problem, solution: bs.demo, research: "off" }, deps());
    expect(r.explanation).toBeDefined();
    expect(r.fix?.verified).toBe(true);
  });
});

