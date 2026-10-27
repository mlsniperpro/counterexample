import { describe, expect, it } from "vitest";
import { explainPrompt, generatorsPrompt, oraclePrompt, signature, understandPrompt } from "@/lib/agent/prompts";
import type { Problem } from "@/lib/problems/types";

const BIG = "\u0000int:15999999992000000001";
const problem: Problem = {
  id: "p",
  title: "T",
  statement: "S",
  params: [{ name: "x", type: { kind: "int", min: 0, max: 10 } }],
  returns: "r",
  examples: [{ args: [1, 2 ** 60], output: BIG }],
  compare: "exact",
  timeLimitMs: 1000,
  memoryLimitMb: 256,
};
const text = (m: { content: string }[]) => m.map((x) => x.content).join("\n");

describe("prompts show big integers as digits, never as the internal marker string", () => {
  it("lists example arguments and outputs as plain digits", () => {
    const t = text(oraclePrompt(problem));
    expect(t).toContain("- solve(1, 1152921504606846976) == 15999999992000000001");
    expect(t).not.toContain("int:");
  });

  it("writes the counterexample's arguments and expected output the same way", () => {
    const t = text(explainPrompt(problem, { language: "python", code: "x", entry: "solve" }, [2 ** 60], BIG, "0"));
    expect(t).toContain("solve(1152921504606846976) should return 15999999992000000001 but returned 0");
    expect(t).not.toContain("int:");
  });
});

describe("the input DSL a model is shown", () => {
  const sol = { language: "python" as const, code: "x", entry: "solve" };

  it("documents the graph shape option, so a model can ask for deep chains", () => {
    for (const t of [text(generatorsPrompt(problem, sol, [])), text(understandPrompt("S", "x", "python"))]) {
      expect(t).toContain('"shape":"random"|"path"');
      expect(t).toMatch(/"path" starts with the chain 0->1->\.\.\.->n-1/);
    }
  });
});

describe("the explain prompt with an input that could not be shrunk", () => {
  it("clips the arguments and the expected value, marking the cut, so a 200,000-value input cannot blow the model's context", () => {
    const huge = Array.from({ length: 200_000 }, (_, i) => 1_000_000_000_000 + i);
    const t = text(explainPrompt(problem, { language: "python", code: "x", entry: "solve" }, [huge], huge, "0"));
    expect(t.length).toBeLessThan(20_000);
    expect(t.match(/\[truncated, \d+ more chars\]/g)).toHaveLength(2);
    expect(t).toContain("solve([1000000000000,1000000000001,");
  });
});

describe("understand prompt", () => {
  it("says when to compare as floats", () => {
    expect(text(understandPrompt("Return the average.", "x", "python"))).toMatch(/Use "float" when the answer holds non-integer numbers/);
  });
});

describe("the oracle's signature", () => {
  it("spells a graph parameter as the two arguments the harness passes", () => {
    const g = { kind: "graph", n: { min: 1, max: 3 }, m: { min: 0, max: 2 }, weight: { min: 0, max: 1 } } as const;
    expect(signature({ ...problem, params: [{ name: "graph", type: g }, { name: "k", type: { kind: "int", min: 0, max: 1 } }] })).toBe("graph_n, graph_edges, k");
    // The built-ins already name it as two arguments.
    expect(signature({ ...problem, params: [{ name: "n, edges", type: g }] })).toBe("n, edges");
    expect(text(oraclePrompt({ ...problem, params: [{ name: "g", type: g }] }))).toContain("def solve(g_n, g_edges):");
  });
});
