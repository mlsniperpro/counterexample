import { describe, expect, it } from "vitest";
import { firstFunctionName, parseUnderstanding } from "@/lib/agent/understand";
import { ModelOutputError } from "@/lib/errors";

const spec = {
  title: "Sum",
  entry: "add",
  params: [
    { name: "a", type: { kind: "int", min: -10, max: 10 } },
    { name: "b", type: { kind: "int", min: -10, max: 10 } },
  ],
  returns: "a + b",
  examples: [{ args: [1, 2], output: 3 }],
  compare: "exact",
};
const run = async (answer: unknown) =>
  parseUnderstanding(typeof answer === "string" ? answer : "```json\n" + JSON.stringify(answer) + "\n```", "Add two numbers.", { code: "def add(a, b): return a + b", language: "python" });

describe("parseUnderstanding (live-mode statement to typed spec)", () => {
  it("turns a valid model answer into a Problem", async () => {
    const { problem, entry } = await run(spec);
    expect(entry).toBe("add");
    expect(problem).toMatchObject({ id: "custom", title: "Sum", statement: "Add two numbers.", compare: "exact", examples: spec.examples });
    expect(problem.params[0]!.type).toEqual({ kind: "int", min: -10, max: 10 });
  });

  it("normalises cosmetic fields and finds the entry in the code when the model omits it", async () => {
    const { problem, entry } = await run({ ...spec, entry: null, title: "T".repeat(100), returns: null, references: ["a", "b", "c"] });
    expect(entry).toBe("add");
    expect(problem.title).toHaveLength(80);
    expect(problem.returns).toBe("");
    expect(problem.references).toEqual(["a", "b"]);
  });

  it("firstFunctionName finds Python and JavaScript entry points", () => {
    expect(firstFunctionName("import x\n\ndef helper(a):\n  pass\ndef solve(b): pass", "python")).toBe("helper");
    expect(firstFunctionName("// c\nconst solve = (a) => a;", "javascript")).toBe("solve");
    expect(firstFunctionName("function go(x) {}", "javascript")).toBe("go");
    expect(firstFunctionName("x = 1", "python")).toBeUndefined();
  });

  it("rejects malformed or unsafe answers with ModelOutputError", async () => {
    const bad: unknown[] = [
      "not json",
      { ...spec, entry: "add(); import os" },
      { ...spec, params: [] },
      { ...spec, params: [{ name: "a", type: { kind: "int", min: 5, max: 1 } }] },
      { ...spec, examples: [] },
      { ...spec, compare: "fuzzy" },
    ];
    for (const b of bad) await expect(run(b), JSON.stringify(b).slice(0, 50)).rejects.toThrow(ModelOutputError);
    expect(() => parseUnderstanding(JSON.stringify({ ...spec, entry: null }), "x", { code: "print(1)", language: "python" })).toThrow(/no entry function/);
  });
});
