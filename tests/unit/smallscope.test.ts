import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { sequences, smallScope, smallScopeInputs } from "@/lib/core/smallscope";
import { argsConform, maxValues, SPEC_LIMITS, type TypeSpec } from "@/lib/core/spec";
import { PROBLEMS, getProblem } from "@/lib/problems/catalog";
import { graphSpecArb, typeSpecArb } from "../arbitraries";
import { cpuClock, runs } from "../helpers";

const specsOf = (id: string) => getProblem(id)!.params.map((p) => p.type);

describe("small-scope (bounded exhaustive) inputs", () => {
  it("covers every small integer, including the one random sampling skipped", () => {
    const xs = smallScopeInputs(specsOf("isqrt"), 400).map((a) => a[0] as number);
    for (let x = 0; x <= 24; x++) expect(xs).toContain(x);
    expect(xs).toContain(2147483647);
    expect(xs[0]).toBe(0); // smallest first
  });

  it("enumerates short strings, small arrays and small graphs within the constraints", () => {
    expect(smallScopeInputs(specsOf("longest-unique-substring"), 400).map((a) => a[0])).toEqual(expect.arrayContaining(["", "a", "ab", "aba", "abba".slice(0, 3)]));
    const coins = smallScopeInputs(specsOf("coin-change"), 400);
    expect(coins.length).toBeGreaterThan(50);
    const graphs = smallScopeInputs(specsOf("shortest-paths"), 400);
    expect(graphs.some(([n, es]) => n === 3 && (es as number[][]).length === 2 && (es as number[][]).some((e) => e[2]! < 0))).toBe(true);
  });

  it("samples evenly across the whole enumeration when it must cut, not a prefix", () => {
    const specs = specsOf("binary-search");
    const full = smallScope(specs, 10_000);
    expect(full).toMatchObject({ total: 371, capped: false });
    const cut = smallScope(specs, 300);
    expect(cut.total).toBe(371);
    expect(cut.inputs).toHaveLength(300);
    expect(new Set(cut.inputs.map((x) => JSON.stringify(x))).size).toBe(300);
    // Every kept input is from the full list, in order, and the first one is kept.
    const index = cut.inputs.map((x) => full.inputs.findIndex((y) => JSON.stringify(y) === JSON.stringify(x)));
    expect(index[0]).toBe(0);
    expect(index).toEqual([...index].sort((a, b) => a - b));
    // A prefix would stop inside the arrays of length 2; the sample reaches the longest arrays too.
    const lengths = new Set(cut.inputs.map((x) => (x[0] as unknown[]).length));
    expect(lengths).toEqual(new Set(full.inputs.map((x) => (x[0] as unknown[]).length)));
    expect(Math.max(...index)).toBeGreaterThan(360);
    expect(smallScopeInputs(specs, 300)).toEqual(cut.inputs);
  });

  it("contributes nothing (and allocates nothing big) for graphs that are not small", () => {
    const cpu = cpuClock();
    expect(smallScopeInputs([{ kind: "graph", n: { min: 1000, max: 1000 }, m: { min: 0, max: 10 }, weight: { min: 0, max: 1 } }], 100)).toEqual([]);
    expect(cpu()).toBeLessThan(150);
  });

  it("always conforms, never repeats, and respects the cap, for every catalog problem", () => {
    for (const p of PROBLEMS) {
      const specs = p.params.map((x) => x.type);
      const xs = smallScopeInputs(specs, 300);
      expect(xs.length, p.id).toBeGreaterThan(0);
      expect(xs.length).toBeLessThanOrEqual(300);
      expect(new Set(xs.map((x) => JSON.stringify(x))).size).toBe(xs.length);
      expect(xs.every((x) => argsConform(x, specs))).toBe(true);
    }
  });

  it("is safe on arbitrary specs: conforming, bounded, deterministic", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.oneof(typeSpecArb, graphSpecArb), { minLength: 1, maxLength: 3 }), fc.integer({ min: 1, max: 200 }), async (specs, cap) => {
        const a = smallScopeInputs(specs, cap);
        expect(a.length).toBeLessThanOrEqual(cap);
        expect(a.every((x) => argsConform(x, specs))).toBe(true);
        expect(smallScopeInputs(specs, cap)).toEqual(a);
        // Deep runs (FC_NUM_RUNS=5000) take minutes: let the test runner's worker answer its own heartbeats between cases.
        await new Promise((resolve) => setImmediate(resolve));
      }),
      { numRuns: runs(100) },
    );
  });
});

describe("small-scope sampling over a space too big to enumerate", () => {
  const I = (min: number, max: number): TypeSpec => ({ kind: "int", min, max });
  const arr: TypeSpec = { kind: "array", of: I(-100, 100), len: { min: 0, max: 5 } };
  const distinct = (xs: unknown[][], i: number) => new Set(xs.map((a) => JSON.stringify(a[i]))).size;

  it("spreads each parameter's values over its whole range, not over a prefix of the product", () => {
    // knapsack-like: weights, values, capacity. 40 x 40 x 27 = 43,200 combinations, more than are enumerated.
    const specs = [arr, arr, I(0, 100)];
    const r = smallScope(specs, 300);
    expect(r.inputs).toHaveLength(300);
    expect(r.inputs.every((a) => argsConform(a, specs))).toBe(true);
    // The first parameter alone has 40 small values (arrays of length 0..3 over 3 elements); a prefix of the product kept 19 of them.
    const full = [smallScope([arr], 1e6).total, smallScope([arr], 1e6).total, smallScope([I(0, 100)], 1e6).total];
    expect(full).toEqual([40, 40, 27]);
    for (const i of [0, 1, 2]) expect(distinct(r.inputs, i)).toBeGreaterThanOrEqual(Math.floor(0.9 * (full[i] as number)));
    expect(Math.max(...r.inputs.map((a) => (a[0] as unknown[]).length))).toBe(3);
    expect(r.inputs.map((a) => a[2])).toEqual(expect.arrayContaining([0, 24, 100]));
    expect(r.capped).toBe(true);
    expect(r.space).toBe(43_200);
  });

  it("does not alias a digit onto a few of its values when the stride shares a factor with its radix", () => {
    // 20^4 = 160,000 combinations; 20,000 sampled gives a stride of 8, which shares a factor of 4 with 20.
    const specs = [I(0, 19), I(0, 19), I(0, 19), I(0, 19)];
    const r = smallScope(specs, 300);
    for (const i of [0, 1, 2, 3]) expect(distinct(r.inputs, i)).toBe(20);
    expect(r.capped).toBe(true);
    expect(r.space).toBe(160_000);
  });

  it("is deterministic and never builds the product (a huge space is quick)", () => {
    const specs = Array.from({ length: 8 }, () => arr);
    const cpu = cpuClock();
    const a = smallScope(specs, 300);
    expect(cpu()).toBeLessThan(800);
    expect(a.capped).toBe(true);
    expect(a.space).toBe(40 ** 8);
    expect(a.inputs).toHaveLength(300);
    expect(smallScope(specs, 300)).toEqual(a);
  });

  it("enumerates a space that fits completely, in order, as before", () => {
    const r = smallScope([I(0, 2), I(0, 1)], 100);
    expect(r).toMatchObject({ capped: false, space: 6, total: 6 });
    expect(r.inputs).toEqual([[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]]);
  });
});

describe("small-scope with graphs that have no small instances", () => {
  const I = (min: number, max: number): TypeSpec => ({ kind: "int", min, max });
  const graph = (n: [number, number], m: [number, number], extra: Partial<Extract<TypeSpec, { kind: "graph" }>> = {}): TypeSpec => ({ kind: "graph", n: { min: n[0], max: n[1] }, m: { min: m[0], max: m[1] }, weight: { min: 0, max: 5 }, ...extra });

  it("keeps the other parameters' small inputs when a graph has n.min above the small limit (its smallest valid graph stands in)", () => {
    const specs = [graph([9, 20], [0, 5]), I(0, 3)];
    const r = smallScope(specs, 300);
    expect(r.inputs).toEqual([0, 1, 2, 3].map((x) => [9, [], x]));
    expect(r.standIn).toBe(true);
    expect(r.inputs.every((a) => argsConform(a, specs))).toBe(true);
  });

  it("builds the stand-in with the fewest nodes and edges the spec allows, and respects dag", () => {
    expect(smallScope([graph([10, 10], [2, 5], { dag: true }), I(0, 0)], 10).inputs).toEqual([[10, [[0, 1, 0], [0, 1, 0]], 0]]);
    expect(smallScope([graph([0, 4], [1, 5], { dag: true }), I(0, 0)], 10).inputs.every((a) => argsConform(a, [graph([0, 4], [1, 5], { dag: true }), I(0, 0)]))).toBe(true);
    // No valid graph at all (a dag with one node cannot have an edge): nothing is invented.
    expect(smallScope([graph([1, 1], [1, 5], { dag: true }), I(0, 3)], 10).inputs).toEqual([]);
    // A graph that is not small even at its smallest (many mandatory edges) is not stood in for either.
    expect(smallScope([graph([9, 20], [100, 200]), I(0, 3)], 10).inputs).toEqual([]);
  });

  it("still contributes nothing for a graph alone that is not small", () => {
    expect(smallScope([graph([9, 20], [0, 5])], 100).inputs).toEqual([]);
  });

  it("enumerates graphs that need two edges (m.min 2) on 6 to 8 nodes", () => {
    const specs = [graph([6, 8], [2, 5])];
    const r = smallScope(specs, 300);
    expect(r.inputs.length).toBeGreaterThan(0);
    expect(r.inputs.every((a) => (a[1] as unknown[]).length === 2 && argsConform(a, specs))).toBe(true);
    expect(new Set(r.inputs.map((a) => a[0]))).toEqual(new Set([6, 7, 8]));
    // With another parameter, the family is not emptied either.
    expect(smallScope([graph([6, 8], [2, 5]), I(0, 3)], 300).inputs.length).toBeGreaterThan(0);
  });

  it("builds fixed-length arrays and strings in linear time, without the shorter layers", () => {
    for (const L of [200, SPEC_LIMITS.maxLen]) {
      const specs: TypeSpec[] = [{ kind: "array", of: I(0, 9), len: { min: L, max: L } }, { kind: "string", alphabet: "abc", len: { min: L, max: L } }];
      const cpu = cpuClock();
      const r = smallScope(specs, 300);
      expect(cpu()).toBeLessThan(400);
      expect(r.inputs.length).toBeGreaterThan(0);
      expect(r.inputs.every((a) => argsConform(a, specs))).toBe(true);
    }
  });

  it("builds nested values only as far as they are used (a tuple of 16 one-ofs of 16 arrays of 10 ints)", () => {
    const arr10 = (min: number): TypeSpec => ({ kind: "array", of: I(0, 100), len: { min, max: 10 } });
    const nested: TypeSpec = { kind: "tuple", items: Array.from({ length: 16 }, () => ({ kind: "oneOf", options: Array.from({ length: 16 }, (_, j) => arr10(j % 2 ? 10 : 0)) })) };
    const deep: TypeSpec = { kind: "tuple", items: Array.from({ length: 16 }, () => ({ kind: "tuple", items: Array.from({ length: 16 }, () => arr10(10)) })) };
    // Accepted specs (within the value limit) that took 4 to 8 s and up to 1.1 GB each when every leaf was built in full.
    const cpu = cpuClock();
    for (const spec of [nested, deep, { kind: "oneOf", options: Array.from({ length: 16 }, () => deep) } as TypeSpec]) {
      expect(maxValues(spec)).toBeLessThanOrEqual(SPEC_LIMITS.maxValuesPerInput);
      const r = smallScope([spec], 300);
      expect(r.inputs.length).toBeGreaterThan(0);
      expect(r.inputs.every((a) => argsConform(a, [spec]))).toBe(true);
    }
    expect(cpu()).toBeLessThan(1500);
  });

  it("shares one value budget across every option and item of a spec, top-level one-ofs included", () => {
    const big = (): TypeSpec => ({ kind: "array", of: I(0, 9), len: { min: 10_000, max: 10_000 } });
    const specs: TypeSpec[] = [
      { kind: "oneOf", options: Array.from({ length: 16 }, () => ({ kind: "oneOf", options: Array.from({ length: 16 }, big) })) },
      { kind: "oneOf", options: Array.from({ length: 16 }, () => ({ kind: "tuple", items: Array.from({ length: 16 }, big) })) },
    ];
    // These took 2.2 s (559 MB) and 7.6 s of CPU when only nested values were limited.
    const cpu = cpuClock();
    for (const spec of specs) {
      const r = smallScope([spec], 300);
      expect(r.inputs.length).toBeGreaterThan(0);
      expect(r.inputs.every((a) => argsConform(a, [spec]))).toBe(true);
    }
    expect(cpu()).toBeLessThan(1500);
  });

  it("spreads a tuple item's values over all of them, not a prefix that fixes its first elements", () => {
    const spec: TypeSpec = { kind: "tuple", items: [{ kind: "string", alphabet: "abc", len: { min: 4, max: 6 } }] };
    const firsts = new Set(smallScope([spec], 200).inputs.map((a) => ((a[0] as unknown[])[0] as string)[0]));
    expect(firsts).toEqual(new Set(["a", "b", "c"]));
  });

  it("stops a sequence list at its limit, shortest first", () => {
    expect(sequences(["a", "b"], 0, 3, 5)).toEqual([[], ["a"], ["b"], ["a", "a"], ["a", "b"]]);
    expect(sequences(["a", "b"], 2, 3, 100)).toHaveLength(4 + 8);
    expect(sequences(["a"], 5, 5, 1)).toEqual([["a", "a", "a", "a", "a"]]);
  });

  it("enumerates short sequences exactly as growing them layer by layer does", () => {
    // The layered construction this replaced: grow each layer from the first 5000 of the one below.
    const layered = (items: string[], minLen: number, maxLen: number) => {
      const out: string[][] = [];
      let layer: string[][] = [[]];
      for (let len = 0; len <= maxLen; len++) {
        if (len >= minLen) out.push(...layer);
        if (len === maxLen) break;
        layer = layer.slice(0, 5000).flatMap((s) => items.map((x) => [...s, x]));
      }
      return out;
    };
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 0, max: 10 }), fc.integer({ min: 0, max: 3 }), (k, min, extra) => {
        const items = ["a", "b", "c"].slice(0, k);
        expect(sequences(items, min, min + extra)).toEqual(layered(items, min, min + extra));
      }),
      { numRuns: runs(60) },
    );
  });

  it("keeps arrays and strings whose minimum length is above the layer limit", () => {
    const longArr: TypeSpec = { kind: "array", of: I(0, 9), len: { min: 9, max: 12 } };
    const longStr: TypeSpec = { kind: "string", alphabet: "abc", len: { min: 9, max: 12 } };
    for (const spec of [longArr, longStr]) {
      const r = smallScope([spec, I(0, 2)], 300);
      expect(r.inputs.length).toBeGreaterThan(0);
      expect(r.inputs.every((a) => argsConform(a, [spec, I(0, 2)]))).toBe(true);
    }
  });
});
