import { describe, expect, it } from "vitest";
import { attack } from "@/lib/agent/run";
import { makeDeps } from "@/lib/agent/setup";
import { UpstreamError } from "@/lib/errors";
import { FIXTURES } from "@/fixtures/replay";
import type { ReplayFixtures } from "@/lib/models/replay";
import { BUILT_INS, getProblem } from "@/lib/problems/catalog";
import type { ResearchClient } from "@/lib/research/tavily";
import type { ModelProvider } from "@/lib/models/types";
import { isCompileFailure } from "@/lib/agent/stages";

const env = { NODE_ENV: "test" };
const builtIn = (id: string) => BUILT_INS.find((b) => b.problem.id === id)!;
const deps = (fixtures?: ReplayFixtures) => makeDeps({ mode: "replay", env, fixtures });

describe("agent failure paths (replay mode)", () => {
  it("keeps going, visibly, when Tavily is down", async () => {
    const down: ResearchClient = { name: "tavily", search: async () => Promise.reject(new UpstreamError("tavily", "HTTP 503: unavailable", 503, true)) };
    const b = builtIn("binary-search");
    const r = await attack({ problem: b.problem, solution: b.demo }, { ...deps(), research: down });
    expect(r.research?.facts).toEqual([]);
    expect(r.verdict).toBe("counterexample");
    expect(r.research?.error).toMatch(/tavily: HTTP 503/);
    expect(r.trace.some((e) => e.kind === "warn" && /Research failed/.test(e.msg))).toBe(true);
  });

  it("says so when research is needed but no client is configured", async () => {
    const b = builtIn("binary-search");
    const r = await attack({ problem: b.problem, solution: b.demo }, { ...deps(), research: null });
    expect(r.research?.error).toMatch(/TAVILY_API_KEY/);
    expect(r.verdict).toBe("counterexample");
  });

  it("drops research facts that cite URLs outside the search results", async () => {
    const fx: ReplayFixtures = { ...FIXTURES, "binary-search": { ...FIXTURES["binary-search"], research: '{"facts":[{"fact":"made up","url":"https://evil.example"}]}' } };
    const b = builtIn("binary-search");
    const r = await attack({ problem: b.problem, solution: b.demo }, deps(fx));
    expect(r.research?.facts).toEqual([]);
    expect(r.trace.some((e) => /not in the search results/.test(e.msg))).toBe(true);
  });

  it("reports rejected generator families and still attacks with examples, mutations and random inputs", async () => {
    const fx: ReplayFixtures = { ...FIXTURES, "coin-change": { ...FIXTURES["coin-change"], generators: '{"families":[{"name":"broken","args":[{"kind":"int","min":9,"max":1}]}]}' } };
    const b = builtIn("coin-change");
    const r = await attack({ problem: b.problem, solution: b.demo }, deps(fx));
    expect(r.trace.some((e) => e.kind === "warn" && /Rejected family broken/.test(e.msg))).toBe(true);
    expect(r.families.map((f) => f.source)).not.toContain("model");
    expect(r.verdict).toBe("counterexample");
  });

  it("ends with an error verdict (no bug claimed) when the generator answer is not JSON at all", async () => {
    const fx: ReplayFixtures = { ...FIXTURES, isqrt: { ...FIXTURES.isqrt, generators: "Sorry, I can't help with that." } };
    const r = await attack({ problem: getProblem("isqrt")!, solution: builtIn("isqrt").demo }, deps(fx));
    expect(r.verdict).toBe("error");
    expect(r.message).toMatch(/no JSON object.*during attack/);
    expect(r.counterexample).toBeUndefined();
  });

  it("recognises a solution that does not compile", async () => {
    const r = await attack({ problem: getProblem("isqrt")!, solution: { language: "javascript", code: "function solve(x) { return x +; }", entry: "solve" } }, deps());
    expect(r.verdict).toBe("compile_error");
    expect(r.message).toMatch(/^compile: .*SyntaxError/s);
  });

  it("finds a hanging solution and reports the timeout as the failure", async () => {
    const code = "def solve(nums, target):\n    while target == 0:\n        pass\n    return nums.index(target) if target in nums else -1\n";
    const r = await attack({ problem: getProblem("binary-search")!, solution: { language: "python", code, entry: "solve" }, research: "off" }, deps());
    expect(r.verdict).toBe("counterexample");
    expect(r.counterexample?.got).toMatch(/^timeout/);
    expect(r.counterexample?.args[1]).toBe(0);
  });

  it("cuts off a hanging model call at the wall-clock deadline", async () => {
    const hanging: ModelProvider = {
      name: "nebius",
      complete: (req) => new Promise((_, reject) => req.signal?.addEventListener("abort", () => reject(req.signal!.reason))),
    };
    const t0 = Date.now();
    const r = await attack({ problem: getProblem("isqrt")!, solution: builtIn("isqrt").demo }, { ...deps(), provider: hanging, budgets: { wallClockMs: 200 } });
    expect(r.verdict).toBe("budget_exhausted");
    expect(r.message).toMatch(/wallClock.*during oracle/);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("records every planned family, including those skipped after the first hit", async () => {
    const b = builtIn("isqrt");
    const r = await attack({ problem: b.problem, solution: b.demo }, deps());
    const names = r.families.map((f) => f.name);
    expect(names).toEqual(["examples", "int32-bounds", "tiny", "perfect-squares-neighbourhood", "random-large", "mutations", "baseline-random"]);
    expect(r.families.filter((f) => f.tested > 0).length).toBeLessThan(names.length);
  });

  it("only calls it a compile error when every example failed to load", () => {
    const hit = (family: string, got: string) => ({ args: [], family, j: { status: "mismatch" as const, got } });
    expect(isCompileFailure([hit("examples", "compile: SyntaxError"), hit("examples", "compile: SyntaxError")], 2)).toBe(true);
    expect(isCompileFailure([hit("examples", "compile: SyntaxError")], 2)).toBe(false);
    expect(isCompileFailure([hit("big", "compile: killed"), hit("big", "compile: killed")], 2)).toBe(false);
    expect(isCompileFailure([], 0)).toBe(false);
  });

  it("flags models without a known price instead of guessing a cost", async () => {
    const d = makeDeps({ mode: "replay", env: { ...env, MODEL_FAST: "some/unknown-model" } });
    const b = builtIn("longest-unique-substring");
    const r = await attack({ problem: b.problem, solution: b.demo }, d);
    expect(r.stats.unpricedCalls).toBe(1);
    expect(r.stages.find((s) => s.purpose === "generators")?.costUsd).toBeNull();
    expect(r.trace.some((e) => /No price known for some\/unknown-model/.test(e.msg))).toBe(true);
  });

  it("marks a fix as not verified when the run budget ends mid re-attack", async () => {
    const b = builtIn("binary-search");
    const input = { problem: b.problem, solution: b.demo, research: "off" as const };
    // Same budgets except maxRuns, which leaves room for about half of the re-attack.
    const budgets = { maxShrinkEvals: 100 };
    const full = await attack(input, { ...deps(), budgets });
    const r = await attack(input, { ...deps(), budgets: { ...budgets, maxRuns: full.stats.runs - full.fix!.reattackInputs } });
    expect(r.verdict).toBe("counterexample");
    expect(r.fix?.verified).toBe(false);
    expect(r.fix!.reattackInputs).toBeLessThan(full.fix!.reattackInputs);
    expect(r.trace.some((e) => /not verified/.test(e.msg))).toBe(true);
  });
});
