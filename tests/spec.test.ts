import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/core/rng";
import { argsConform, conforms, genArgs, genValue, parseTypeSpec, type TypeSpec } from "@/lib/core/spec";
import { outputsEqual } from "@/lib/core/compare";
import { PROBLEMS } from "@/lib/problems/catalog";
import { FIXTURES } from "@/fixtures/replay";
import { extractJson } from "@/lib/agent/parse";

describe("generators (input DSL)", () => {
  it("are deterministic for a seed", () => {
    const spec: TypeSpec[] = [{ kind: "array", of: { kind: "int", min: -100, max: 100 }, len: { min: 0, max: 20 } }, { kind: "string", alphabet: "xyz", len: { min: 1, max: 5 } }];
    const a = Array.from({ length: 20 }, ((r) => () => genArgs(spec, r))(mulberry32(42)));
    const b = Array.from({ length: 20 }, ((r) => () => genArgs(spec, r))(mulberry32(42)));
    expect(a).toEqual(b);
  });

  it("produce values that conform to their spec", () => {
    const rng = mulberry32(7);
    for (const p of PROBLEMS) {
      const specs = p.params.map((x) => x.type);
      for (let i = 0; i < 200; i++) expect(argsConform(genArgs(specs, rng), specs)).toBe(true);
    }
  });

  it("honour sorted, distinct, pool and nondecreasing tuples", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 100; i++) {
      const xs = genValue({ kind: "array", of: { kind: "int", min: 0, max: 9 }, len: { min: 5, max: 5 }, sorted: "asc", distinct: true }, rng) as number[];
      expect(xs).toEqual([...new Set(xs)].sort((a, b) => a - b));
      const pooled = genValue({ kind: "array", of: { kind: "int", min: -1000, max: 1000 }, len: { min: 10, max: 10 }, pool: 2 }, rng) as number[];
      expect(new Set(pooled).size).toBeLessThanOrEqual(2);
      const t = genValue({ kind: "tuple", items: [{ kind: "int", min: 0, max: 9 }, { kind: "int", min: 0, max: 9 }], nondecreasing: true }, rng) as number[];
      expect(t[0]).toBeLessThanOrEqual(t[1]);
    }
  });

  it("edge bias hits the bounds", () => {
    const rng = mulberry32(1);
    const xs = Array.from({ length: 300 }, () => genValue({ kind: "int", min: 0, max: 2147483647, bias: "edges" }, rng));
    expect(xs).toContain(2147483647);
    expect(xs).toContain(0);
  });

  it("graphs with dag=true only have forward edges inside range", () => {
    const rng = mulberry32(5);
    const spec: TypeSpec = { kind: "graph", n: { min: 1, max: 6 }, m: { min: 0, max: 10 }, weight: { min: -5, max: 5 }, dag: true };
    for (let i = 0; i < 200; i++) {
      const [n, edges] = genArgs([spec], rng) as [number, number[][]];
      for (const [u, v] of edges) expect(u < v && v < n).toBe(true);
    }
  });

  it("parseTypeSpec rejects malformed model output", () => {
    expect(() => parseTypeSpec({ kind: "int", min: 5, max: 1 })).toThrow(/bad range/);
    expect(() => parseTypeSpec({ kind: "float" })).toThrow(/unknown kind/);
    expect(() => parseTypeSpec({ kind: "array", of: { kind: "int", min: 0, max: 1 } })).toThrow(/len/);
    expect(parseTypeSpec({ kind: "int", min: 0, max: 3, bias: "weird" })).toEqual({ kind: "int", min: 0, max: 3, bias: "uniform" });
  });

  it("every replay generator family parses and fits its problem's arity", () => {
    for (const p of PROBLEMS) {
      const text = FIXTURES[p.id]?.generators as string;
      const fams = (extractJson(text) as { families: { args: unknown[] }[] }).families;
      expect(fams.length).toBeGreaterThanOrEqual(3);
      for (const f of fams) {
        const specs = f.args.map((a) => parseTypeSpec(a));
        const rng = mulberry32(9);
        const ok = Array.from({ length: 50 }, () => argsConform(genArgs(specs, rng), p.params.map((x) => x.type))).filter(Boolean).length;
        expect(ok, `${p.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("conforms rejects out-of-range and wrong shapes", () => {
    expect(conforms(3.5, { kind: "int", min: 0, max: 9 })).toBe(false);
    expect(conforms("abz", { kind: "string", alphabet: "ab", len: { min: 0, max: 5 } })).toBe(false);
    expect(conforms([2, 1], { kind: "array", of: { kind: "int", min: 0, max: 9 }, len: { min: 0, max: 5 }, sorted: "asc" })).toBe(false);
  });
});

describe("output comparison", () => {
  it("supports exact, unordered and float modes", () => {
    expect(outputsEqual([1, 2], [1, 2])).toBe(true);
    expect(outputsEqual([1, 2], [2, 1])).toBe(false);
    expect(outputsEqual([1, 2], [2, 1], "unordered")).toBe(true);
    expect(outputsEqual(0.1 + 0.2, 0.3, "float")).toBe(true);
    expect(outputsEqual([0, null], [0, null])).toBe(true);
  });
});
