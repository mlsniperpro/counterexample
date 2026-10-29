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

  it("compares as floats when an example output is written with a decimal point, and otherwise keeps the model's exact", async () => {
    const mean = { ...spec, returns: "the mean", examples: [{ args: [1, 3], output: 2 }] };
    const parse = (text: string, statement = "Return the mean of a and b.") => parseUnderstanding(text, statement, { code: "def add(a, b): return (a + b) / 2", language: "python" });
    const fenced = (o: unknown) => "```json\n" + JSON.stringify(o) + "\n```";
    // Written as 2.0 (JSON.stringify would write 2, so the text is edited).
    const written = await parse(fenced(mean).replace('"output":2', '"output":2.0'));
    expect(written.problem.compare).toBe("float");
    expect(written.note).toMatch(/^The examples write their outputs with a decimal point, so outputs are compared as floats/);
    // An exponent alone is how integers are written too, and words in the return type or the statement change nothing:
    // "int (the decimal value)" or "exactly: floating-point is not accurate enough" must keep an integer problem exact.
    expect((await parse(fenced(mean).replace('"output":2', '"output":2e0'))).problem.compare).toBe("exact");
    expect((await parse(fenced({ ...mean, returns: "int (the decimal value of F(n))" }))).problem.compare).toBe("exact");
    expect((await parse(fenced(mean), "Return F(n) exactly: floating-point arithmetic is not accurate enough.")).problem.compare).toBe("exact");
    // Exact mode still lets a float answer differ by rounding, and still catches an integer off by one in the low digits.
    expect(outputsEqual(1.6666666666666665, 1.6666666666666667, "exact")).toBe(true);
    const [fib] = parseLines('\x1eCX{"ok":true,"out":14472334024676221,"ms":1}\n').map((o) => (o.ok ? o.out : undefined));
    expect(outputsEqual(fib, 14472334024676220, "exact")).toBe(false);
  });

  it("refuses a problem whose inputs hold more than the per-input value limit across all their parameters", async () => {
    const big = { kind: "array", of: { kind: "array", of: { kind: "int", min: 0, max: 9 }, len: { min: 0, max: 10 } }, len: { min: 0, max: 10_000 } };
    await expect(run({ ...spec, params: Array.from({ length: 3 }, (_, i) => ({ name: `a${i}`, type: big })), examples: [{ args: [[], [], []], output: 3 }] })).rejects.toThrow(/across its arguments \(limit 200000\)/);
  });

  it("reads what has one obvious meaning instead of failing the attack: an entry written as a call, extra examples, long text, huge bounds", async () => {
    const r = await run({
      ...spec,
      entry: "add(a, b)",
      params: [
        { name: "a".repeat(60), type: { kind: "int", min: 1, max: 1e18 } },
        { name: "b", type: { kind: "int", min: -1e18, max: 10 } },
      ],
      examples: Array.from({ length: 12 }, (_, i) => ({ args: [i, 1], output: i + 1 })),
      references: ["x".repeat(300)],
    });
    expect(r.entry).toBe("add");
    expect(r.problem.examples).toHaveLength(10);
    expect(r.problem.params[0]?.name).toHaveLength(40);
    expect(r.problem.params[0]?.type).toMatchObject({ kind: "int", min: 1, max: Number.MAX_SAFE_INTEGER });
    expect(r.problem.params[1]?.type).toMatchObject({ kind: "int", min: -Number.MAX_SAFE_INTEGER, max: 10 });
    expect(r.problem.references?.[0]).toHaveLength(200);
    expect(r.note).toMatch(/Integer bounds beyond 2\^53 - 1 were lowered/);
  });

  it("reads an entry padded with a long run of spaces in linear time", async () => {
    const t0 = process.cpuUsage();
    expect((await run({ ...spec, entry: "a" + " ".repeat(60_000) + "!" })).entry).toBe("add");
    const used = process.cpuUsage(t0);
    expect((used.user + used.system) / 1000).toBeLessThan(300);
  });

  it("reads the entry in any form a model writes it, and falls back to the code when there is none", async () => {
    for (const entry of ["def add(a, b)", "add(a: int, b: int) -> int", "Solution.add", "`add`", '"add"', "", null]) expect((await run({ ...spec, entry })).entry, String(entry)).toBe("add");
  });

  it("keeps a const value exactly as written, and lowers a pool past the length cap", async () => {
    const value = { sorted: false, pool: 0, distinct: false, min: 1, max: 1e18, keep: 1 };
    const r = await run({ ...spec, params: [{ name: "a", type: { kind: "array", of: { kind: "const", value }, len: { min: 0, max: 3 }, pool: 100_000 } }, spec.params[1]] });
    expect(r.problem.params[0]?.type).toMatchObject({ of: { kind: "const", value }, pool: 10_000 });
  });

  it("shortens the longest list when an input would pass the value cap, instead of failing (10^4 words of up to 20 letters)", async () => {
    const words = { kind: "array", of: { kind: "string", alphabet: "abc", len: { min: 1, max: 20 } }, len: { min: 1, max: 10_000 } };
    const r = await run({ ...spec, params: [{ name: "words", type: words }, spec.params[1]], examples: [{ args: [["a"], 1], output: 3 }] });
    const len = (r.problem.params[0]?.type as { len: { max: number } }).len.max;
    expect(len).toBeLessThan(10_000);
    expect(len).toBeGreaterThan(9_900);
    expect(r.note).toMatch(/The longest list was shortened/);
  });

  it("reads flags written as off and a hyphenated comparison mode", async () => {
    const r = await run({ ...spec, compare: "unordered-nested", params: [{ name: "a", type: { kind: "array", of: { kind: "int", min: 0, max: 9 }, len: { min: 0, max: 5 }, sorted: false, pool: 0, distinct: false } }, spec.params[1]] });
    expect(r.problem.compare).toBe("unordered_nested");
    expect(r.problem.params[0]?.type).toEqual({ kind: "array", of: { kind: "int", min: 0, max: 9 }, len: { min: 0, max: 5 } });
  });

  it("lowers sizes past the generator's caps instead of failing, and says so", async () => {
    const r = await run({
      ...spec,
      params: [
        { name: "a", type: { kind: "array", of: { kind: "int", min: 0, max: 9 }, len: { min: 1, max: 100_000 } } },
        { name: "b", type: { kind: "string", alphabet: "ab", len: { min: 0, max: 50_000 } } },
      ],
      examples: [{ args: [[1], "a"], output: 3 }],
    });
    expect(r.problem.params[0]?.type).toMatchObject({ len: { min: 1, max: 10_000 } });
    expect(r.problem.params[1]?.type).toMatchObject({ len: { min: 0, max: 10_000 } });
    expect(r.note).toMatch(/Sizes beyond the generator's limits were lowered/);
    // A fixed length past the cap: its minimum comes down too, or the range would be empty.
    const fixed = await run({ ...spec, params: [{ name: "a", type: { kind: "array", of: { kind: "int", min: 0, max: 9 }, len: { min: 100_000, max: 100_000 } } }, spec.params[1]], examples: [{ args: [[1], 1], output: 3 }] });
    expect(fixed.problem.params[0]?.type).toMatchObject({ len: { min: 10_000, max: 10_000 } });
    // Graph sizes too: n <= 10^5 nodes and 2 * 10^5 edges come down to the caps.
    const g = await run({ ...spec, params: [{ name: "g", type: { kind: "graph", n: { min: 2, max: 100_000 }, m: { min: 1, max: 200_000 }, weight: { min: 0, max: 9 } } }], examples: [{ args: [2, [[0, 1, 1]]], output: 3 }] });
    expect(g.problem.params[0]?.type).toMatchObject({ n: { min: 2, max: 1_000 }, m: { min: 1, max: 10_000 } });
  });

  it("leaves out examples whose arguments hold integers past 2^53, which no program receives exactly", async () => {
    const text = '```json\n{"title":"Sum","entry":"add","params":[{"name":"a","type":{"kind":"int","min":-10,"max":9007199254740991}},{"name":"b","type":{"kind":"int","min":-10,"max":10}}],"examples":[{"args":[9223372036854775807,1],"output":9223372036854775808},{"args":[1,2],"output":3}]}\n```';
    const r = parseUnderstanding(text, "Add.", { code: "def add(a, b): return a + b", language: "python" });
    expect(r.problem.examples).toEqual([{ args: [1, 2], output: 3 }]);
    expect(r.note).toMatch(/1 example\(s\) whose arguments hold integers beyond 2\^53 were left out/);
    await expect(run({ ...spec, examples: [{ args: [2 ** 63, 1], output: 0 }] })).rejects.toThrow(/every example passes an integer beyond 2\^53/);
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

    it("falls back to the last top-level function (helpers come first), with a note, instead of failing every input as a load error", async () => {
      const r = await entryFor("import math\n\ndef helper(a):\n    return a\n\ndef add(a, b):\n    return a + b\n", "python");
      expect(r.entry).toBe("add");
      expect(r.note).toMatch(/named entry "missing", which the code does not define; using "add"/);
    });

    it("falls back to a function that takes the problem's parameters, never a trailing main()", async () => {
      const code = "import math\n\ndef floor_root(x):\n    return math.isqrt(x)\n\ndef main():\n    print(floor_root(16))\n\nif __name__ == '__main__':\n    main()\n";
      const one = { ...spec, entry: "squareRoot", params: [{ name: "x", type: { kind: "int", min: 0, max: 100 } }], examples: [{ args: [4], output: 2 }] };
      expect(parseUnderstanding("```json\n" + JSON.stringify(one) + "\n```", "isqrt", { code, language: "python" }).entry).toBe("floor_root");
      expect((await entryFor("function solveIt(a, b) { return a + b; }\nfunction helper(x) { return x; }\n", "javascript", "missing")).entry).toBe("solveIt");
    });

    it("takes the name the code defines from any way a model writes the entry, never a later helper", async () => {
      const py = "def max_profit(prices, fee):\n    return 0\n\ndef clamp(x, lo):\n    return max(x, lo)\n";
      for (const entry of ["Solution().max_profit", "max_profit(prices, fee)", "def max_profit(prices: List[int], fee: int) -> int"]) expect((await entryFor(py, "python", entry)).entry, entry).toBe("max_profit");
      const js = "var twoSum = function (nums, target) { return [0, 1]; };\nfunction helper(a, b) { return a; }\n";
      for (const entry of ["var twoSum = function(nums, target)", "const twoSum = (nums, target) =>", "twoSum"]) expect((await entryFor(js, "javascript", entry)).entry, entry).toBe("twoSum");
    });

    it("never takes a parameter name that a driver line assigns, or a parameter reassigned in the body", async () => {
      const py = "def two_sum(nums, target):\n    return [0, 1]\n\nnums = [2, 7, 11, 15]\ntarget = 9\nprint(two_sum(nums, target))\n";
      expect((await entryFor(py, "python", "twoSum(nums, target)")).entry).toBe("two_sum");
      const js = "const nums = [1];\nvar rotate = function (nums, k) {\n  k = (k % nums.length + nums.length) % nums.length;\n  return nums;\n};\n";
      for (const entry of ["var rotate = function(nums, k)", "const rotate = (nums, k) =>"]) expect((await entryFor(js, "javascript", entry)).entry, entry).toBe("rotate");
    });

    it("counts parameters with commas inside type annotations as one, so the arity fallback picks the right function", async () => {
      const code = "def helper(a, b):\n    return a\n\ndef count_pairs(nums: Dict[int, int], target: Tuple[int, int]):\n    return 0\n\ndef main():\n    pass\n";
      expect((await entryFor(code, "python", "missing")).entry).toBe("count_pairs");
    });

    it("stays linear on JavaScript with long space runs around a generator star", async () => {
      const code = "function" + " ".repeat(40_000) + "*" + " ".repeat(40_000) + "helper(a){}\nfunction real(a, b) { return a + b; }\n";
      const t0 = process.cpuUsage();
      await entryFor(code, "javascript", "missing");
      const used = process.cpuUsage(t0);
      expect((used.user + used.system) / 1000).toBeLessThan(500);
    });

    it("finds the named function spelled another way before any fallback", async () => {
      // A correct isqrt with a clamp helper above it: the model's camelCase name means integer_sqrt, not clamp.
      const code = "def clamp(x):\n    return max(0, x)\n\ndef integer_sqrt(n):\n    return int(n ** 0.5)\n\ndef unused():\n    pass\n";
      expect((await entryFor(code, "python", "integerSqrt")).entry).toBe("integer_sqrt");
      expect((await entryFor("function twoSum(a) { return 0; }\nfunction helper() {}\n", "javascript", "two_sum")).entry).toBe("twoSum");
      // A binding to a wrapped function is a definition too.
      expect((await entryFor("const memoize = (f) => f;\nconst solve = memoize((a, b) => a + b);\n", "javascript", "solve")).entry).toBe("solve");
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
      { ...spec, params: [] },
      { ...spec, params: [{ name: "a", type: { kind: "int", min: 5, max: 1 } }] },
      { ...spec, examples: [] },
      { ...spec, compare: "fuzzy" },
    ];
    for (const b of bad) await expect(run(b), JSON.stringify(b).slice(0, 50)).rejects.toThrow(ModelOutputError);
    // An entry is only ever an identifier taken from the text, never the text itself.
    expect((await run({ ...spec, entry: "add(); import os" })).entry).toBe("add");
    expect(() => parseUnderstanding(JSON.stringify({ ...spec, entry: null }), "x", { code: "print(1)", language: "python" })).toThrow(/no entry function/);
  });
});
