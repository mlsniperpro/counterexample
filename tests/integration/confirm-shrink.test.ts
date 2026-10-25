import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attack } from "@/lib/agent/run";
import { makeDeps } from "@/lib/agent/setup";
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
