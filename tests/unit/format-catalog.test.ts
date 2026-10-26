import { describe, expect, it } from "vitest";
import { fmtArgs, ms, toMarkdown, usd, VERDICT, type ReportNoTrace } from "@/app/format";
import { explainPrompt, generatorsPrompt, oraclePrompt, researchPrompt, understandPrompt } from "@/lib/agent/prompts";
import { argsConform } from "@/lib/core/spec";
import { BUILT_INS, getProblem, PROBLEMS } from "@/lib/problems/catalog";

describe("UI formatting", () => {
  it("formats arguments, durations and money", () => {
    expect(fmtArgs([[1, 2], "a", null])).toBe('[1,2], "a", null');
    expect(ms(12.4)).toBe("12 ms");
    expect(ms(1500)).toBe("1.5 s");
    expect(usd(0.001234)).toBe("$0.00123");
    expect(usd(1.5)).toBe("$1.500");
    expect(usd(null)).toBe("unpriced");
    expect(Object.keys(VERDICT)).toHaveLength(6);
  });

  it("renders a report as Markdown with the counterexample, fix status and routing", () => {
    const r: ReportNoTrace = {
      verdict: "counterexample",
      message: "Found a minimal counterexample.",
      problem: { id: "p", title: "P" },
      solution: { language: "python", code: "x", entry: "solve" },
      setup: { provider: "replay", executor: "Local", research: "none", routing: "routed", reasoningModel: "u", fastModel: "s" },
      families: [],
      counterexample: { args: [[0], 0], expected: 0, got: "-1", original: { args: [[0], 0], family: "f" }, shrinkSteps: 0, shrinkEvals: 0, shrinkExhausted: false },
      explanation: "Because.",
      fix: { code: "def solve(): pass\n", verified: true, attempts: 1, reattackInputs: 10, reattackMismatches: 0, reattackUnjudged: 0 },
      stats: { modelCalls: 2, runs: 5, inputsTested: 3, wallMs: 1, timeToFirstCounterexampleMs: 1, costUsd: 0.001, unpricedCalls: 0, simulatedModelMs: 0 },
      stages: [{ stage: "oracle", purpose: "oracle", role: "reasoning", model: "u", why: "w", calls: 1, promptTokens: 1, completionTokens: 1, costUsd: null, latencyMs: 10, simulated: true }],
    };
    const md = toMarkdown(r);
    expect(md).toContain("solve([0], 0)");
    expect(md).toContain("got:      -1");
    expect(md).toContain("## Fix (verified: re-attacked on 10 judged inputs: 0 failures)");
    expect(md).toContain("| oracle | u (replay) | 1 | unpriced | 10 ms (simulated) |");
  });
});

describe("problem catalog", () => {
  it("has 13 problems (10 base, 3 hard-tier) with unique ids and 5 built-in demos", () => {
    expect(new Set(PROBLEMS.map((p) => p.id)).size).toBe(13);
    expect(BUILT_INS).toHaveLength(5);
    expect(getProblem("nope")).toBeUndefined();
  });

  it("every example conforms to its problem's declared parameter types", () => {
    for (const p of PROBLEMS) {
      for (const e of p.examples) expect(argsConform(e.args, p.params.map((x) => x.type)), `${p.id} ${JSON.stringify(e.args)}`).toBe(true);
      expect(p.examples.length).toBeGreaterThan(0);
    }
  });

  it("demo code does not give the bug away", () => {
    for (const b of BUILT_INS) {
      expect(b.demo.code).not.toMatch(/BUG/);
      expect(b.demo.bug.length).toBeGreaterThan(20);
    }
  });
});

describe("prompts", () => {
  const p = getProblem("binary-search")!;
  const s = BUILT_INS[0]!.demo;

  it("give each model what it needs and the exact output format", () => {
    expect(oraclePrompt(p)[1]!.content).toMatch(/SLOW BUT OBVIOUSLY CORRECT[\s\S]*def solve\(nums, target\)/);
    expect(oraclePrompt(p, "solve(1) returned 2")[1]!.content).toContain("Your previous oracle was wrong:\nsolve(1) returned 2");
    const g = generatorsPrompt(p, s, [{ fact: "length >= 1", url: "https://l" }])[1]!.content;
    expect(g).toContain("length >= 1 [https://l]");
    expect(g).toContain(s.code);
    expect(g).toMatch(/"families"/);
    expect(explainPrompt(p, s, [[0], 0], 0, "-1")[1]!.content).toContain("solve([0], 0) should return 0 but returned -1");
    expect(researchPrompt(p, [{ title: "T", url: "https://u", content: "C".repeat(5000) }])[1]!.content.length).toBeLessThan(3000);
    expect(understandPrompt("stmt", "code", "python")[1]!.content).toContain('"entry"');
  });
});
