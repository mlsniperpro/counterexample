import { describe, expect, it } from "vitest";
import { attack, type Report } from "@/lib/agent/run";
import { makeDeps } from "@/lib/agent/setup";
import { Tracer, type TraceEvent } from "@/lib/agent/trace";
import { BUILT_INS, getProblem } from "@/lib/problems/catalog";
import { DEFAULT_FAST_MODEL, DEFAULT_REASONING_MODEL } from "@/lib/models/config";
import { readFileSync } from "node:fs";
import { splitHeader } from "../../scripts/gen-demos";

const builtIn = (id: string) => BUILT_INS.find((b) => b.problem.id === id)!;
const deps = (routing: "routed" | "ultra-only" = "routed") => makeDeps({ mode: "replay", routing, env: { NODE_ENV: "test" } });

describe("agent loop, end to end in replay mode (no keys)", () => {
  let bs: Report;
  const streamed: TraceEvent[] = [];

  it("binary search: researches, finds and shrinks the off-by-one, verifies the fix", async () => {
    const b = builtIn("binary-search");
    bs = await attack({ problem: b.problem, solution: b.demo }, { ...deps(), onEvent: (e) => streamed.push(e) });
    expect(bs.verdict).toBe("counterexample");
    expect(bs.counterexample?.args).toEqual([[0], 0]);
    expect(bs.counterexample?.expected).toBe(0);
    expect(bs.counterexample?.got).toBe("-1");
    expect(bs.fix?.verified).toBe(true);
    expect(bs.fix?.reattackInputs).toBeGreaterThan(500);
    expect(bs.explanation).toMatch(/lo < hi/);
    // Tavily research is cited and shaped generator families.
    expect(bs.research?.facts.length).toBeGreaterThan(0);
    expect(bs.research?.influencedFamilies).toContain("single-element");
  });

  it("streams a structured trace with every stage, model call and run", () => {
    expect(streamed).toEqual(bs.trace);
    const stages = new Set(bs.trace.map((e) => e.stage));
    for (const s of ["understand", "research", "oracle", "attack", "run", "shrink", "explain", "reattack", "report"]) expect(stages.has(s as never)).toBe(true);
    const calls = bs.trace.filter((e) => e.kind === "model_call");
    const byPurpose = Object.fromEntries(calls.map((c) => [c.data!.purpose, c.data!.model]));
    expect(byPurpose).toEqual({ research: DEFAULT_FAST_MODEL, oracle: DEFAULT_REASONING_MODEL, generators: DEFAULT_FAST_MODEL, explain: DEFAULT_REASONING_MODEL });
    expect(calls.every((c) => typeof c.data!.why === "string" && c.data!.simulated === true)).toBe(true);
    expect(bs.trace.some((e) => e.kind === "exec")).toBe(true);
    const tr = new Tracer(0, () => 0);
    tr.emit("run", "info", "x");
    expect(JSON.parse(tr.jsonl().trim())).toMatchObject({ stage: "run", msg: "x" });
    expect(bs.stats.timeToFirstCounterexampleMs).toBeGreaterThan(0);
    expect(bs.stats.costUsd).toBeGreaterThan(0);
  });

  it("longest substring: finds a minimal 'abba'-shaped input and verifies the fix", async () => {
    const b = builtIn("longest-unique-substring");
    const r = await attack({ problem: b.problem, solution: b.demo }, deps());
    expect(r.verdict).toBe("counterexample");
    expect(r.counterexample?.args[0]).toMatch(/^(.)(?!\1)(.)\2\1$/);
    expect(r.fix?.verified).toBe(true);
    expect(r.research).toBeUndefined();
  });

  it("every built-in can research the web on request, with cited facts that shape a family", async () => {
    for (const b of BUILT_INS) {
      const r = await attack({ problem: b.problem, solution: b.demo, research: "force" }, deps());
      expect(r.research?.error, b.problem.id).toBeUndefined();
      expect(r.research?.facts.length, b.problem.id).toBeGreaterThan(0);
      expect(r.research?.influencedFamilies.length, b.problem.id).toBeGreaterThan(0);
      expect(r.verdict, b.problem.id).toBe("counterexample");
      expect(r.trace.some((e) => e.kind === "stage_start" && e.msg.startsWith("Researching with Tavily: Research the web was requested")), b.problem.id).toBe(true);
    }
  });

  it("drops family citations when the run did no research (a model may only cite what it was given)", async () => {
    const b = builtIn("coin-change");
    const auto = await attack({ problem: b.problem, solution: b.demo }, deps());
    expect(auto.research).toBeUndefined();
    expect(auto.families.find((f) => f.name === "non-canonical-systems")?.citations).toEqual([]);
    expect(auto.trace.some((e) => /Removed 1 citation\(s\)/.test(e.msg))).toBe(true);
    const forced = await attack({ problem: b.problem, solution: b.demo, research: "force" }, deps());
    expect(forced.families.find((f) => f.name === "non-canonical-systems")?.citations).toEqual(["https://en.wikipedia.org/wiki/Change-making_problem"]);
  });

  it("on request, researches the documentation of risky APIs the code calls, and the docs shape the attack", async () => {
    const auto = await attack({ problem: builtIn("isqrt").problem, solution: builtIn("isqrt").demo }, deps());
    expect(auto.research).toBeUndefined();
    expect(auto.trace.some((e) => /^The code calls bitwise operators .*Tick "Research the web"/.test(e.msg))).toBe(true);

    const isqrt = await attack({ problem: builtIn("isqrt").problem, solution: builtIn("isqrt").demo, research: "force" }, deps());
    expect(isqrt.research?.queries).toEqual(["Integer square root constraints edge cases", "JavaScript right shift operator converts operands to 32-bit integers"]);
    expect(isqrt.research?.facts.map((f) => f.url)).toContain("https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Right_shift");
    expect(isqrt.research?.influencedFamilies).toContain("int32-bounds");
    expect(isqrt.trace.some((e) => e.kind === "stage_start" && /the code calls bitwise operators/.test(e.msg))).toBe(true);
    expect(isqrt.counterexample?.args).toEqual([2147483647]);

    const sortBug = readFileSync("bench/solutions/merge-intervals/bug-b.js", "utf8");
    const merge = await attack({ problem: getProblem("merge-intervals")!, solution: { language: "javascript", code: splitHeader(sortBug).code, entry: "solve" }, research: "force" }, deps());
    // The problem question has no recorded results in replay mode (reported, not fatal); the API question does.
    expect(merge.research?.facts.map((f) => f.url)).toEqual(["https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort"]);
    expect(merge.research?.error).toMatch(/Merge intervals constraints edge cases/);
    expect(merge.research?.influencedFamilies).toEqual(["two-digit-starts"]);
    expect(merge.verdict).toBe("counterexample");
  });

  it("raises no false alarm on a correct solution", async () => {
    const p = getProblem("binary-search")!;
    const { code } = splitHeader(readFileSync("bench/solutions/binary-search/correct.py", "utf8"));
    const r = await attack({ problem: p, solution: { language: "python", code, entry: "solve" } }, deps());
    expect(r.verdict).toBe("no_counterexample");
    expect(r.stats.inputsTested).toBeGreaterThan(500);
    expect(r.explanation).toBeUndefined();
  });

  it("ultra-only routing sends every call to the reasoning model and costs more", async () => {
    const b = builtIn("binary-search");
    const r = await attack({ problem: b.problem, solution: b.demo }, deps("ultra-only"));
    expect(r.trace.filter((e) => e.kind === "model_call").every((e) => e.data!.model === DEFAULT_REASONING_MODEL)).toBe(true);
    expect(r.stats.costUsd).toBeGreaterThan(bs.stats.costUsd);
    expect(r.counterexample?.args).toEqual(bs.counterexample?.args);
  });

  it("built-in demos are generated from the benchmark files", async () => {
    const { renderDemos } = await import("../../scripts/gen-demos");
    expect(readFileSync("src/lib/problems/demos.generated.ts", "utf8")).toBe(renderDemos(process.cwd()));
  });
});

describe("stage budgets", () => {
  const b = builtIn("coin-change");

  it("stops at the model-call budget without claiming a bug", async () => {
    const r = await attack({ problem: b.problem, solution: b.demo }, { ...deps(), budgets: { maxModelCalls: 1 } });
    expect(r.verdict).toBe("budget_exhausted");
    expect(r.message).toMatch(/modelCalls.*during attack/);
    expect(r.stats.modelCalls).toBe(1);
  });

  it("stops at the run budget", async () => {
    const r = await attack({ problem: b.problem, solution: b.demo }, { ...deps(), budgets: { maxRuns: 4 } });
    expect(r.verdict).toBe("budget_exhausted");
    expect(r.message).toMatch(/runs/);
  });

  it("stops at the wall-clock budget", async () => {
    let now = 0;
    const clock = () => (now += 1000);
    const r = await attack({ problem: b.problem, solution: b.demo }, { ...deps(), clock, budgets: { wallClockMs: 5000 } });
    expect(r.verdict).toBe("budget_exhausted");
    expect(r.message).toMatch(/wallClock/);
  });

  it("keeps a found counterexample when the budget runs out during the fix", async () => {
    const r = await attack({ problem: b.problem, solution: b.demo }, { ...deps(), budgets: { maxModelCalls: 2 } });
    expect(r.verdict).toBe("counterexample");
    expect(r.counterexample).toBeDefined();
    expect(r.fix).toBeUndefined();
  });

  it("refuses to claim bugs when the oracle never matches the examples", async () => {
    const p = getProblem("isqrt")!;
    const bad = "```python\ndef solve(x):\n    return x\n```";
    const d = makeDeps({ mode: "replay", env: { NODE_ENV: "test" }, fixtures: { isqrt: { oracle: bad, generators: "{}" } } });
    const r = await attack({ problem: p, solution: builtIn("isqrt").demo }, d);
    expect(r.verdict).toBe("oracle_unreliable");
    expect(r.oracle?.attempts).toBe(3);
  });
});
