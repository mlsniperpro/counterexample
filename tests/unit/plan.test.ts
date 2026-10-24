import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { replayFallbacks } from "@/lib/agent/setup";
import { getProblem } from "@/lib/problems/catalog";
import type { Solution } from "@/lib/problems/types";
import { codeOnly, detectApiRisks, MAX_QUERIES, researchPlan } from "@/lib/research/plan";
import { RESEARCH_RESULTS } from "@/fixtures/replay";

const js = (code: string): Solution => ({ language: "javascript", code, entry: "solve" });

describe("API risk detection (questions the code raises)", () => {
  it("finds risky calls and ignores comments and strings", () => {
    expect(detectApiRisks("xs.sort();", "javascript").map((r) => r.id)).toEqual(["js-sort-default"]);
    expect(detectApiRisks("xs.sort((a, b) => a - b);", "javascript")).toEqual([]);
    expect(detectApiRisks("const mid = (lo + hi) >> 1;", "javascript").map((r) => r.id)).toEqual(["js-bitwise-32"]);
    expect(detectApiRisks("return x | 0;", "javascript").map((r) => r.id)).toEqual(["js-bitwise-32"]);
    expect(detectApiRisks("return a || b;", "javascript")).toEqual([]);
    expect(detectApiRisks("const c = (m.get(k) || 0) + 1;", "javascript")).toEqual([]);
    expect(detectApiRisks("const c = x|0;", "javascript").map((r) => r.id)).toEqual(["js-bitwise-32"]);
    expect(detectApiRisks("return Math.round(Math.sqrt(x));", "javascript").map((r) => r.id)).toEqual(["js-math-round"]);
    expect(detectApiRisks("return round(x / 2)", "python").map((r) => r.id)).toEqual(["py-round-even"]);
    expect(detectApiRisks("return np.round(x)", "python")).toEqual([]);
    expect(detectApiRisks('// xs.sort()\nconst s = "Math.round(";\n/* a >> 1 */', "javascript")).toEqual([]);
    expect(detectApiRisks("# round(x)\ns = 'round('", "python")).toEqual([]);
  });

  it("codeOnly never grows the code and keeps code outside literals", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), fc.constantFrom<"python" | "javascript">("python", "javascript"), (s, lang) => {
        expect(codeOnly(s, lang).length).toBeLessThanOrEqual(s.length + 2);
      }),
    );
    expect(codeOnly('a = "x"; b(1) // c', "javascript")).toBe('a = ""; b(1) ');
  });

  it("every detectable API question has recorded search results for replay mode", () => {
    for (const code of ["xs.sort()", "a >> 1", "Math.round(x)"]) for (const r of detectApiRisks(code, "javascript")) expect(RESEARCH_RESULTS[r.query], r.id).toBeDefined();
    for (const r of detectApiRisks("round(x)", "python")) expect(RESEARCH_RESULTS[r.query], r.id).toBeDefined();
  });
});

describe("researchPlan", () => {
  const isqrt = getProblem("isqrt")!;
  const bs = getProblem("binary-search")!;

  it("asks nothing when nothing is external and the code is plain", () => {
    expect(researchPlan(isqrt, js("function solve(x) { return Math.floor(Math.sqrt(x)); }"), "auto")).toEqual({ queries: [], reasons: [] });
  });

  it("in auto mode without cited sources, never researches (as the brief requires) but suggests it for risky APIs", () => {
    const plan = researchPlan(isqrt, js("function solve(x) { return Math.round(Math.sqrt(x)); }"), "auto");
    expect(plan.queries).toEqual([]);
    expect(plan.suggestion).toMatch(/^The code calls Math\.round\(\), whose documentation lists edge cases \(rounds halves toward \+Infinity.*Tick "Research the web"/);
  });

  it("when asked, researches the problem and the APIs the code calls", () => {
    const plan = researchPlan(isqrt, js("function solve(x) { return Math.round(Math.sqrt(x)); }"), "force");
    expect(plan.queries).toEqual([
      { query: "Integer square root constraints edge cases", reason: "problem", label: "Integer square root" },
      { query: "JavaScript Math.round fractional part exactly 0.5", reason: "api", label: "Math.round()" },
    ]);
    expect(plan.reasons).toEqual(["Research the web was requested", "the code calls Math.round(), which has documented edge cases"]);
  });

  it("names only the APIs whose questions fit under the cap", () => {
    const plan = researchPlan(isqrt, js("function solve(a) { a.sort(); return Math.round(a[0] >> 1); }"), "force");
    expect(plan.queries).toHaveLength(MAX_QUERIES);
    expect(plan.reasons[1]).toBe("the code calls Array.prototype.sort() without a comparator, which has documented edge cases");
  });

  it("keeps one problem and one API question when both exist, within the cap", () => {
    const plan = researchPlan(bs, js("function solve(a, t) { a.sort(); return (a.length - 1) >> 1; }"), "auto");
    expect(plan.queries.map((q) => q.reason)).toEqual(["problem", "api"]);
    expect(plan.queries.length).toBeLessThanOrEqual(MAX_QUERIES);
  });

  it("forces a problem question on request, and asks nothing (and suggests nothing) when off", () => {
    expect(researchPlan(isqrt, js("function solve(x) { return x; }"), "force").queries).toEqual([{ query: "Integer square root constraints edge cases", reason: "problem", label: "Integer square root" }]);
    expect(researchPlan(bs, js("x.sort()"), "off")).toEqual({ queries: [], reasons: [] });
  });
});

describe("replay lookup order", () => {
  it("falls back from solution to problem, and from a research question to the shared API entry then the problem", () => {
    expect(replayFallbacks("isqrt/bug-a")).toEqual(["isqrt"]);
    expect(replayFallbacks("isqrt?q=Q")).toEqual(["api?q=Q", "isqrt"]);
    expect(replayFallbacks("isqrt")).toEqual([]);
  });
});
