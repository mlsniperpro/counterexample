import { describe, expect, it } from "vitest";
import { attack, type Report } from "@/lib/agent/run";
import { makeDeps } from "@/lib/agent/setup";
import { Tracer, type TraceEvent } from "@/lib/agent/trace";
import { BUILT_INS, getProblem } from "@/lib/problems/catalog";
import { DEFAULT_FAST_MODEL, DEFAULT_REASONING_MODEL } from "@/lib/models/config";
import { readFileSync } from "node:fs";
import { splitHeader } from "../scripts/gen-demos";

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
    const { renderDemos } = await import("../scripts/gen-demos");
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
