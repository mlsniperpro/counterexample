import { describe, expect, it } from "vitest";
import { firstFunctionName, hasFraction, parseUnderstanding } from "@/lib/agent/understand";
import { ModelOutputError } from "@/lib/errors";
import { outputsEqual } from "@/lib/core/compare";
import { parseLines } from "@/lib/exec/program";

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
  it("keeps example outputs beyond 2^53 exact, so a correct oracle's exact output matches them", async () => {
    const text = "```json\n" + JSON.stringify(spec).replace('"output":3', '"output":15999999992000000001') + "\n```";
    const { problem } = await run(text);
    const [oracleOut] = parseLines('\x1eCX{"ok":true,"out":15999999992000000001,"ms":1}\n').map((o) => (o.ok ? o.out : undefined));
    expect(outputsEqual(oracleOut, problem.examples[0]!.output)).toBe(true);
    expect(outputsEqual(15999999992000000000, problem.examples[0]!.output)).toBe(false);
    expect(problem.examples[0]!.args).toEqual([1, 2]);
  });

  it("compares as floats when the examples return fractions, whatever the model chose, and says so", async () => {
    const avg = { ...spec, examples: [{ args: [1, 2], output: 1.5 }] };
    for (const answer of [avg, { ...avg, compare: undefined }]) {
      const { problem, note } = await run(answer);
      expect(problem.compare).toBe("float");
      expect(note).toMatch(/compared as floats/);
      // A correct solution that sums in another order is not a counterexample.
      expect(outputsEqual(1.6666666666666665, 1.6666666666666667, problem.compare)).toBe(true);
    }
    // Integer outputs keep exact, and an explicit "unordered" is kept.
    expect((await run(spec)).problem.compare).toBe("exact");
    expect((await run({ ...avg, compare: "unordered" })).problem.compare).toBe("unordered");
  });

  it("refuses a problem whose inputs hold more than the per-input value limit across all their parameters", async () => {
    const big = { kind: "array", of: { kind: "array", of: { kind: "int", min: 0, max: 9 }, len: { min: 0, max: 10 } }, len: { min: 0, max: 10_000 } };
    await expect(run({ ...spec, params: Array.from({ length: 3 }, (_, i) => ({ name: `a${i}`, type: big })), examples: [{ args: [[], [], []], output: 3 }] })).rejects.toThrow(/across its arguments \(limit 200000\)/);
  });

  it("finds a fraction anywhere in an output", () => {
    expect([1.5, [1, [2.25]], { a: { b: 0.1 } }].map(hasFraction)).toEqual([true, true, true]);
    expect([3, [1, 2], { a: 1 }, "1.5", null, Infinity, NaN].map(hasFraction)).toEqual([false, false, false, false, false, false, false]);
  });

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

  it("firstFunctionName also finds exported, default-exported and async JavaScript functions, and skips non-function constants", () => {
    expect(firstFunctionName("export function go(x) {}", "javascript")).toBe("go");
    expect(firstFunctionName("export default function main(x) {}", "javascript")).toBe("main");
    expect(firstFunctionName("export default async function run(x) {}", "javascript")).toBe("run");
    expect(firstFunctionName("async function load(x) {}", "javascript")).toBe("load");
    expect(firstFunctionName("function* gen(x) {}", "javascript")).toBe("gen");
    expect(firstFunctionName("const MOD = 1e9 + 7;\nconst f = (a) => a;", "javascript")).toBe("f");
    expect(firstFunctionName("const MOD = 1e9 + 7;", "javascript")).toBeUndefined();
    expect(firstFunctionName("async def fetch(x): pass", "python")).toBe("fetch");
  });

  describe("an entry the code does not define", () => {
    const entryFor = async (code: string, language: "python" | "javascript", named: string | null = "missing") => {
      const text = "```json\n" + JSON.stringify({ ...spec, entry: named }) + "\n```";
      return parseUnderstanding(text, "Add two numbers.", { code, language });
    };

    it("falls back to the first top-level function, with a note, instead of failing every input as a load error", async () => {
      const r = await entryFor("import math\n\ndef helper(a):\n    return a\n\ndef add(a, b):\n    return a + b\n", "python");
      expect(r.entry).toBe("helper");
      expect(r.note).toMatch(/named entry "missing", which the code does not define; using "helper"/);
    });

    it("prefers a function named solve over an earlier one", async () => {
      expect((await entryFor("def helper(a):\n    return a\ndef solve(a, b):\n    return a + b\n", "python")).entry).toBe("solve");
      expect((await entryFor("function helper(a) { return a; }\nconst solve = (a, b) => a + b;", "javascript")).entry).toBe("solve");
    });

    it("finds JavaScript export, export default and async functions", async () => {
      expect((await entryFor("export function go(a, b) { return a + b; }", "javascript")).entry).toBe("go");
      expect((await entryFor("export default function main(a, b) { return a + b; }", "javascript")).entry).toBe("main");
      expect((await entryFor("async function later(a, b) { return a + b; }", "javascript")).entry).toBe("later");
    });

    it("refuses a method inside a class instead of attacking a helper defined above it", async () => {
      const py = "def is_pos(x):\n    return x > 0\n\nclass Solution:\n    def maxOf(self, nums):\n        return max(nums)\n";
      await expect(entryFor(py, "python", "maxOf")).rejects.toThrow(/"maxOf", a method inside a class: methods are not supported yet, so write it as a top-level function \(without self\)/);
      // With no entry named, a class Solution is refused too rather than replaced by the helper.
      await expect(entryFor(py, "python", null)).rejects.toThrow(/a class Solution: methods are not supported yet/);
      const js = "function isPos(x) { return x > 0; }\nclass Solution {\n  maxOf(nums) {\n    return Math.max(...nums);\n  }\n}\n";
      await expect(entryFor(js, "javascript", "maxOf")).rejects.toThrow(/"maxOf", a method inside a class/);
      // A top-level wrapper that calls the method is attacked, whatever the model named.
      const wrapped = "class Solution:\n    def twoSum(self, nums):\n        return 0\n\ndef solve(nums):\n    return Solution().twoSum(nums)\n";
      expect((await entryFor(wrapped, "python", "twoSum")).entry).toBe("solve");
      // A nested function is not a method: with no class, the usual fallback applies.
      expect((await entryFor("def main(nums):\n    def solve(i):\n        return i\n    return solve(0)\n", "python", "solve")).entry).toBe("main");
      // A top-level solve next to a class is still attacked.
      expect((await entryFor("class Solution:\n    pass\n\ndef solve(a, b):\n    return a + b\n", "python", null)).entry).toBe("solve");
    });

    it("throws a clear ModelOutputError when the code has no function at all", async () => {
      await expect(entryFor("x = 1\nprint(x)\n", "python")).rejects.toThrow(ModelOutputError);
      await expect(entryFor("x = 1\nprint(x)\n", "python")).rejects.toThrow(/entry "missing" is not defined in the code, and the code has no top-level function/);
    });
  });

  describe("an entry the code does define", () => {
    const kept = (named: string, code: string, language: "python" | "javascript") =>
      parseUnderstanding("```json\n" + JSON.stringify({ ...spec, entry: named }) + "\n```", "Add two numbers.", { code, language });

    it("is kept, in every spelling a program can define it", () => {
      const cases: [string, string, "python" | "javascript"][] = [
        ["add", "def helper(): pass\ndef add(a, b):\n    return a + b\n", "python"],
        ["add", "async def add(a, b):\n    return a + b\n", "python"],
        ["add", "add = lambda a, b: a + b\n", "python"],
        ["add", "function add(a, b) { return a + b; }", "javascript"],
        ["add", "export function add(a, b) { return a + b; }", "javascript"],
        ["add", "export default async function add(a, b) { return a + b; }", "javascript"],
        ["add", "const add = (a, b) => a + b;", "javascript"],
        ["add", "var add = function (a, b) { return a + b; };", "javascript"],
        ["add", "add = a => a;", "javascript"],
        ["$f", "function $f(a) { return a; }", "javascript"],
      ];
      for (const [name, code, language] of cases) {
        const r = kept(name, code, language);
        expect(r.entry, code).toBe(name);
        expect(r.note, code).toBeUndefined();
      }
    });

    it("is not matched inside a longer name or as a property", () => {
      // `myadd` and `obj.add` do not define `add`: the fallback names the real first function.
      expect(kept("add", "function myadd(a, b) { return a + b; }", "javascript").entry).toBe("myadd");
      expect(kept("add", "const obj = {};\nobj.add = (a, b) => a + b;\nfunction real(a) {}", "javascript").entry).toBe("real");
      expect(kept("add", "def add_all(a, b):\n    return a + b\n", "python").entry).toBe("add_all");
    });
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
