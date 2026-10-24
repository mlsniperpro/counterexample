import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/core/rng";
import { argsConform, arity, compareJson, conforms, genArgs, genValue, maxValues, parseTypeSpec, SPEC_LIMITS, type TypeSpec } from "@/lib/core/spec";
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

  it("compareJson orders numbers numerically and other values by JSON text", () => {
    expect([10, 9, 100].sort(compareJson)).toEqual([9, 10, 100]);
    expect(compareJson("a", "a")).toBe(0);
    expect(compareJson([1], [2])).toBeLessThan(0);
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
        // const values may be strings longer than one "value"; skip those.
        if (JSON.stringify(spec).includes('"const"')) return;
        expect(count(v)).toBeLessThanOrEqual(Math.max(1, maxValues(spec)));
      }),
    );
  });
});
