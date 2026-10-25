import { describe, expect, it } from "vitest";
import { firstFunctionName, parseUnderstanding } from "@/lib/agent/understand";
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
