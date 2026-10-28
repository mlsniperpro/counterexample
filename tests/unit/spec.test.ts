import fc from "fast-check";
import { cpuClock } from "../helpers";
import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/core/rng";
import { generateInputs } from "@/lib/agent/families";
import { argsConform, arity, compareJson, sortJson, conforms, genArgs, genValue, inputsWithinBudget, maxValues, parseTypeSpec, SPEC_LIMITS, type ArraySpec, type TypeSpec } from "@/lib/core/spec";
import { ModelOutputError } from "@/lib/errors";
import { PROBLEMS } from "@/lib/problems/catalog";
import { graphSpecArb, typeSpecArb } from "../arbitraries";

/** Specs whose constraints can always be met (distinct/sorted can make some unsatisfiable, which conforms must then catch). */
const unconstrained = (s: TypeSpec): boolean =>
  s.kind === "array" ? !s.distinct && !s.sorted && unconstrained(s.of) : s.kind === "tuple" ? s.items.every(unconstrained) : s.kind === "oneOf" ? s.options.every(unconstrained) : true;

const depthOf = (s: TypeSpec): number =>
  s.kind === "array" ? 1 + depthOf(s.of) : s.kind === "tuple" ? 1 + Math.max(...s.items.map(depthOf)) : s.kind === "oneOf" ? 1 + Math.max(...s.options.map(depthOf)) : 1;

describe("generation (input DSL)", () => {
  it("is deterministic for a seed", () => {
    fc.assert(
      fc.property(typeSpecArb, fc.integer(), (spec, seed) => {
        expect(genArgs([spec], mulberry32(seed))).toEqual(genArgs([spec], mulberry32(seed)));
      }),
    );
  });

  it("always produces values that conform to an unconstrained spec", () => {
    fc.assert(
      fc.property(typeSpecArb.filter(unconstrained), fc.integer(), (spec, seed) => {
        expect(argsConform(genArgs([spec], mulberry32(seed)), [spec])).toBe(true);
      }),
    );
  });

  it("graphs expand to (n, edges) that conform, with only forward edges when dag", () => {
    fc.assert(
      fc.property(graphSpecArb, fc.integer(), (spec, seed) => {
        const args = genArgs([spec], mulberry32(seed));
        expect(args).toHaveLength(2);
        expect(arity(spec)).toBe(2);
        if (spec.kind === "graph" && spec.dag) for (const e of args[1] as number[][]) expect(e[0]! < e[1]!).toBe(true);
        const unsatisfiable = spec.kind === "graph" && spec.dag === true && (args[0] as number) < 2 && spec.m.min > 0;
        expect(argsConform(args, [spec])).toBe(!unsatisfiable);
      }),
    );
  });

  it("path-shaped graphs start with the chain 0 -> 1 -> ... as far as the edge count allows", () => {
    fc.assert(
      fc.property(graphSpecArb, fc.integer(), (spec, seed) => {
        if (spec.kind !== "graph") return;
        const path: TypeSpec = { ...spec, shape: "path" };
        const [n, edges] = genArgs([path], mulberry32(seed)) as [number, number[][]];
        const chain = spec.dag && n < 2 ? 0 : Math.min(n - 1, edges.length);
        edges.slice(0, chain).forEach((e, i) => expect([e[0], e[1]]).toEqual([i, i + 1]));
        if (!(spec.dag && n < 2)) expect(edges.length).toBeGreaterThanOrEqual(Math.min(n - 1, spec.m.min));
        const unsatisfiable = spec.dag === true && n < 2 && spec.m.min > 0;
        expect(argsConform([n, edges], [path])).toBe(!unsatisfiable);
      }),
    );
  });

  it("a maximal path-shaped graph is one chain through every node (random edges never are)", () => {
    const spec: TypeSpec = { kind: "graph", shape: "path", n: { min: 1000, max: 1000 }, m: { min: 999, max: 999 }, weight: { min: 0, max: 10 }, dag: true };
    const [n, edges] = genArgs([spec], mulberry32(5)) as [number, number[][]];
    expect(n).toBe(1000);
    expect(edges.map((e) => [e[0], e[1]])).toEqual(Array.from({ length: 999 }, (_, i) => [i, i + 1]));
    const depth = (es: number[][]) => {
      const d = new Array<number>(1000).fill(0);
      for (const [u, v] of [...es].sort((a, b) => a[0]! - b[0]!)) d[v!] = Math.max(d[v!]!, d[u!]! + 1);
      return Math.max(...d);
    };
    expect(depth(edges)).toBe(999);
    const random = genArgs([{ ...spec, shape: "random" }], mulberry32(5))[1] as number[][];
    expect(depth(random)).toBeLessThan(100);
    // The default is unchanged: no shape means random edges, with the same draws as before.
    expect(genArgs([{ ...spec, shape: undefined }], mulberry32(5))).toEqual(genArgs([{ ...spec, shape: "random" }], mulberry32(5)));
  });

  it("generates conforming inputs for every catalog problem", () => {
    const rng = mulberry32(7);
    for (const p of PROBLEMS) {
      const specs = p.params.map((x) => x.type);
      for (let i = 0; i < 200; i++) expect(argsConform(genArgs(specs, rng), specs)).toBe(true);
    }
  });

  it("honours sorted, distinct, pool and nondecreasing tuples", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 100; i++) {
      const xs = genValue({ kind: "array", of: { kind: "int", min: 0, max: 9 }, len: { min: 5, max: 5 }, sorted: "asc", distinct: true }, rng) as number[];
      expect(xs).toEqual([...new Set(xs)].sort((a, b) => a - b));
      const pooled = genValue({ kind: "array", of: { kind: "int", min: -1000, max: 1000 }, len: { min: 10, max: 10 }, pool: 2 }, rng) as number[];
      expect(new Set(pooled).size).toBeLessThanOrEqual(2);
      const t = genValue({ kind: "tuple", items: [{ kind: "int", min: 0, max: 9 }, { kind: "int", min: 0, max: 9 }], nondecreasing: true }, rng) as number[];
      expect(t[0]!).toBeLessThanOrEqual(t[1]!);
    }
  });

  it("gives up quickly on a distinct array far longer than its element domain (no long synchronous sampling)", () => {
    const spec: TypeSpec = { kind: "array", of: { kind: "const", value: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, len: { min: 10_000, max: 10_000 }, distinct: true };
    const cpu = cpuClock();
    for (let i = 0; i < 50; i++) expect((genValue(spec, mulberry32(i)) as unknown[]).length).toBe(1);
    expect(cpu()).toBeLessThan(250);
  });

  it("returns a too-short array (caught by conforms) when distinct values run out", () => {
    const spec: TypeSpec = { kind: "array", of: { kind: "int", min: 0, max: 2 }, len: { min: 5, max: 5 }, distinct: true };
    const xs = genValue(spec, mulberry32(1)) as number[];
    expect(xs.length).toBeLessThan(5);
    expect(conforms(xs, spec)).toBe(false);
  });

  it("edge bias hits the bounds", () => {
    const rng = mulberry32(1);
    const xs = Array.from({ length: 300 }, () => genValue({ kind: "int", min: 0, max: 2147483647, bias: "edges" }, rng));
    expect(xs).toContain(2147483647);
    expect(xs).toContain(0);
  });

  it("refuses graphs nested inside other kinds", () => {
    const g: TypeSpec = { kind: "graph", n: { min: 1, max: 2 }, m: { min: 0, max: 1 }, weight: { min: 0, max: 1 } };
    expect(() => genValue({ kind: "oneOf", options: [g] }, mulberry32(1))).toThrow(/graph/);
    expect(() => genValue({ kind: "tuple", items: [g] }, mulberry32(1))).toThrow(/graph/);
    expect(() => genValue({ kind: "array", of: g, len: { min: 1, max: 1 } }, mulberry32(1))).toThrow(/graph/);
  });
});

describe("conforms / argsConform", () => {
  it("rejects out-of-range, wrong shapes and wrong arity", () => {
    expect(conforms(3.5, { kind: "int", min: 0, max: 9 })).toBe(false);
    expect(conforms("abz", { kind: "string", alphabet: "ab", len: { min: 0, max: 5 } })).toBe(false);
    expect(conforms([2, 1], { kind: "array", of: { kind: "int", min: 0, max: 9 }, len: { min: 0, max: 5 }, sorted: "asc" })).toBe(false);
    expect(conforms([1, 2], { kind: "array", of: { kind: "int", min: 0, max: 9 }, len: { min: 0, max: 5 }, sorted: "desc" })).toBe(false);
    expect(conforms([1, 1], { kind: "array", of: { kind: "int", min: 0, max: 9 }, len: { min: 0, max: 5 }, distinct: true })).toBe(false);
    expect(conforms([3, 1], { kind: "tuple", items: [{ kind: "int", min: 0, max: 9 }, { kind: "int", min: 0, max: 9 }], nondecreasing: true })).toBe(false);
    expect(conforms([1], { kind: "tuple", items: [{ kind: "int", min: 0, max: 9 }, { kind: "int", min: 0, max: 9 }] })).toBe(false);
    expect(conforms(5, { kind: "oneOf", options: [{ kind: "const", value: 4 }, { kind: "int", min: 5, max: 5 }] })).toBe(true);
    expect(argsConform([1, 2], [{ kind: "int", min: 0, max: 9 }])).toBe(false);
  });

  it("checks graph endpoints, weights and direction", () => {
    const g: TypeSpec = { kind: "graph", n: { min: 1, max: 4 }, m: { min: 0, max: 4 }, weight: { min: -1, max: 1 }, dag: true };
    expect(argsConform([3, [[0, 2, 1]]], [g])).toBe(true);
    expect(argsConform([3, [[2, 0, 1]]], [g])).toBe(false); // backwards edge in a DAG
    expect(argsConform([3, [[0, 3, 1]]], [g])).toBe(false); // endpoint out of range
    expect(argsConform([3, [[0, 1, 5]]], [g])).toBe(false); // weight out of range
    expect(argsConform([3, [[0, 1]]], [g])).toBe(false); // not a triple
    expect(argsConform([0, []], [g])).toBe(false); // n below min
  });

  it("compareJson orders values the way a statement means by sorted (as Python compares them)", () => {
    expect([10, 9, 100].sort(compareJson)).toEqual([9, 10, 100]);
    expect(compareJson("a", "a")).toBe(0);
    expect(compareJson([1], [2])).toBeLessThan(0);
    // Strings by character and lists element by element, not by JSON text (where '"a b"' sorts before '"a"').
    expect(["a b", "a", "ab"].sort(compareJson)).toEqual(["a", "a b", "ab"]);
    expect([[10, 1], [2, 1], [-1, 0], [-2, 0]].sort(compareJson)).toEqual([[-2, 0], [-1, 0], [2, 1], [10, 1]]);
    expect([[1, 2], [1]].sort(compareJson)).toEqual([[1], [1, 2]]);
    const intervals: TypeSpec = { kind: "array", of: { kind: "tuple", items: [{ kind: "int", min: -20, max: 20 }, { kind: "int", min: -20, max: 20 }] }, len: { min: 0, max: 5 }, sorted: "asc" };
    expect(conforms([[2, 2], [10, 10]], intervals as Exclude<TypeSpec, { kind: "graph" }>)).toBe(true);
    expect(conforms([[10, 10], [2, 2]], intervals as Exclude<TypeSpec, { kind: "graph" }>)).toBe(false);
    // Generated sorted inputs are sorted in the same order.
    const rng = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const v = genValue(intervals, rng) as number[][];
      expect(v).toEqual([...v].sort(compareJson));
    }
  });
});

describe("parseTypeSpec (untrusted model output)", () => {
  const fails = (raw: unknown, re: RegExp) => {
    expect(() => parseTypeSpec(raw)).toThrow(ModelOutputError);
    expect(() => parseTypeSpec(raw)).toThrow(re);
  };

  it("round-trips every valid spec", () => {
    fc.assert(
      fc.property(fc.oneof(typeSpecArb, graphSpecArb), (spec) => {
        fc.pre(depthOf(spec) <= SPEC_LIMITS.maxDepth);
        const json = JSON.parse(JSON.stringify(spec));
        expect(parseTypeSpec(json)).toEqual(json);
      }),
    );
  });

  it("rejects malformed specs with a reason", () => {
    fails({ kind: "int", min: 5, max: 1 }, /bad range/);
    fails({ kind: "float" }, /kind/);
    fails({ kind: "array", of: { kind: "int", min: 0, max: 1 } }, /len/);
    fails({ kind: "int", min: 0, max: 3, bias: "weird" }, /bias/);
    fails({ kind: "int", min: 0.5, max: 3 }, /int/i);
    fails({ kind: "string", alphabet: "", len: { min: 0, max: 1 } }, /alphabet/);
    fails(null, /expected object|Invalid/i);
    fails({ kind: "graph", n: { min: 1, max: 2 }, m: { min: 0, max: 1 }, weight: { min: 0, max: 1 }, shape: "star" }, /shape/);
  });

  it("bounds what a model may ask for", () => {
    fails({ kind: "array", of: { kind: "int", min: 0, max: 1 }, len: { min: 0, max: SPEC_LIMITS.maxLen + 1 } }, /len/);
    const big = { kind: "array", of: { kind: "array", of: { kind: "int", min: 0, max: 1 }, len: { min: 0, max: 1000 } }, len: { min: 0, max: 1000 } };
    fails(big, /could hold 1000000 values/);
    let deep: unknown = { kind: "int", min: 0, max: 1 };
    for (let i = 0; i < SPEC_LIMITS.maxDepth; i++) deep = { kind: "array", of: deep, len: { min: 0, max: 2 } };
    fails(deep, /nested deeper/);
    fails({ kind: "oneOf", options: [{ kind: "graph", n: { min: 1, max: 2 }, m: { min: 0, max: 1 }, weight: { min: 0, max: 1 } }] }, /top-level/);
  });

  it("maxValues bounds the size of any generated value", () => {
    fc.assert(
      fc.property(typeSpecArb, fc.integer(), (spec, seed) => {
        const count = (v: unknown): number => (Array.isArray(v) ? v.reduce((a: number, x) => a + count(x), 0) : typeof v === "string" ? v.length : 1);
        const v = genArgs([spec], mulberry32(seed))[0];
        expect(count(v)).toBeLessThanOrEqual(Math.max(1, maxValues(spec)));
      }),
    );
  });
});

describe("array pools", () => {
  const ofInt = { kind: "int", min: 0, max: 9 };

  it("never draws a pool larger than the longest array", () => {
    let calls = 0;
    const rng = mulberry32(3);
    const counting = () => (calls++, rng());
    genArgs([{ kind: "array", of: { kind: "int", min: 0, max: 9 }, len: { min: 3, max: 5 }, pool: 10_000 }], counting);
    // Old behaviour drew 10,000 pool values first.
    expect(calls).toBeLessThan(100);
  });

  it("counts the pool in maxValues and refuses a spec that would take seconds to generate", () => {
    const text = { kind: "string", alphabet: "ab", len: { min: 10_000, max: 10_000 } };
    const spec = { kind: "array", of: text, len: { min: 20, max: 20 }, pool: 10_000 };
    expect(maxValues(spec as TypeSpec)).toBe((20 + 20) * 10_000);
    expect(() => parseTypeSpec(spec)).toThrow(/could hold 400000 values/);
    expect(maxValues({ kind: "array", of: ofInt, len: { min: 0, max: 10 }, pool: 4 } as TypeSpec)).toBe(14);
    expect(maxValues({ kind: "array", of: ofInt, len: { min: 0, max: 10 } } as TypeSpec)).toBe(10);
  });

  it("counts a const by what it holds, so an array of a big const is refused, not generated for a minute", () => {
    const big = { kind: "const", value: Array.from({ length: 200 }, (_, i) => i) };
    expect(maxValues(big as TypeSpec)).toBe(200);
    expect(maxValues({ kind: "const", value: { a: "xyz", b: [[], null] } } as TypeSpec)).toBe(3 + 1 + 1);
    expect(maxValues({ kind: "const", value: "" } as TypeSpec)).toBe(1);
    expect(() => parseTypeSpec({ kind: "array", of: big, len: { min: 10_000, max: 10_000 } })).toThrow(/could hold 2000000 values/);
    // A long const array is counted without spreading it into one call's arguments.
    expect(maxValues({ kind: "const", value: new Array(300_000).fill(0) } as TypeSpec)).toBe(300_000);
  });

  it("generates any accepted spec quickly", () => {
    const leaf = fc.oneof(
      fc.constant<unknown>({ kind: "int", min: 0, max: 1000 }),
      fc.record({ kind: fc.constant("string"), alphabet: fc.constant("abc"), len: fc.record({ min: fc.constant(0), max: fc.integer({ min: 0, max: 10_000 }) }) }),
    );
    const arrayArb = fc.record({
      kind: fc.constant("array"),
      of: leaf,
      len: fc.record({ min: fc.constant(0), max: fc.integer({ min: 0, max: 10_000 }) }),
      pool: fc.option(fc.integer({ min: 1, max: 10_000 }), { nil: undefined }),
    });
    fc.assert(
      fc.property(arrayArb, fc.integer(), (raw, seed) => {
        let spec: TypeSpec;
        try {
          spec = parseTypeSpec(raw);
        } catch (e) {
          if (e instanceof ModelOutputError) return;
          throw e;
        }
        const cpu = cpuClock();
        genArgs([spec], mulberry32(seed));
        expect(cpu()).toBeLessThan(150);
      }),
      { numRuns: 60 },
    );
  });
});

describe("value accounting for empty and tiny strings", () => {
  const alphabet = Array.from({ length: 256 }, (_, i) => String.fromCharCode(0x100 + i)).join("");
  const empties = (n: number): ArraySpec => ({ kind: "array", of: { kind: "string", alphabet, len: { min: 0, max: 0 } }, len: { min: n, max: n } });

  it("counts every string as at least one value, so an array of empty strings is bounded like an array of ints", () => {
    expect(maxValues({ kind: "string", alphabet: "ab", len: { min: 0, max: 0 } })).toBe(1);
    expect(maxValues(empties(10_000))).toBe(10_000);
    expect(inputsWithinBudget([empties(10_000)], 300)).toBe(50);
    expect(maxValues({ kind: "array", of: { kind: "string", alphabet: "ab", len: { min: 0, max: 3 } }, len: { min: 0, max: 5 } })).toBe(15);
  });

  it("generates 10,000 empty strings over a 256-character alphabet quickly (the alphabet is not copied per string)", () => {
    const spec = empties(10_000);
    const rng = mulberry32(1);
    const cpu = cpuClock();
    // 50 inputs is what the value budget lets a family hold.
    for (let i = 0; i < 50; i++) expect(genValue(spec, rng) as string[]).toHaveLength(10_000);
    const ms = cpu();
    expect(ms).toBeLessThan(300);
  });

  it("keeps the whole family of such inputs within a second", () => {
    const spec = empties(10_000);
    const cpu = cpuClock();
    const r = generateInputs({ name: "e", rationale: "", citations: [], args: [spec], count: 300, source: "model" }, [spec], 1, "x");
    expect(r.inputs.length).toBeGreaterThan(0);
    expect(cpu()).toBeLessThan(1000);
  });

  it("keeps nested distinct arrays fast when their domain is used up", () => {
    const inner: TypeSpec = { kind: "array", of: { kind: "int", min: 0, max: 0 }, len: { min: 2000, max: 2000 }, distinct: true };
    const spec: TypeSpec = { kind: "array", of: inner, len: { min: 100, max: 100 }, distinct: true };
    const cpu = cpuClock();
    const r = generateInputs({ name: "n", rationale: "", citations: [], args: [spec], count: 300, source: "model" }, [spec], 1, "x");
    expect(r.inputs.length + r.dropped).toBeGreaterThan(0);
    expect(cpu()).toBeLessThan(100);
  });
});

describe("sortJson", () => {
  it("orders exactly as sorting with compareJson does", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.integer(), fc.double({ noNaN: true }), fc.string(), fc.array(fc.integer(), { maxLength: 3 }))), (xs) => {
        const ours = [...xs];
        sortJson(ours);
        // Ties may land in any order; their serialisations line up exactly.
        expect(ours.map((x) => JSON.stringify(x))).toEqual([...xs].sort(compareJson).map((x) => JSON.stringify(x)));
      }),
    );
  });

  it("compares nested arrays in place, so 10,000 of them sort quickly", () => {
    const xs = Array.from({ length: 10_000 }, (_, i) => Array.from({ length: 20 }, (_, j) => (i * 7919 + j * 104729) % 1000));
    const cpu = cpuClock();
    sortJson(xs);
    // Serialising both sides on every comparison took over a second here.
    expect(cpu()).toBeLessThan(400);
  });
});
