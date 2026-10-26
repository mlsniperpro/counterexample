import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { smallScope, smallScopeInputs } from "@/lib/core/smallscope";
import { argsConform } from "@/lib/core/spec";
import { PROBLEMS, getProblem } from "@/lib/problems/catalog";
import { graphSpecArb, typeSpecArb } from "../arbitraries";
import { runs } from "../helpers";

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
    const t0 = Date.now();
    expect(smallScopeInputs([{ kind: "graph", n: { min: 1000, max: 1000 }, m: { min: 0, max: 10 }, weight: { min: 0, max: 1 } }], 100)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(500);
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

  it("is safe on arbitrary specs: conforming, bounded, deterministic", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(typeSpecArb, graphSpecArb), { minLength: 1, maxLength: 3 }), fc.integer({ min: 1, max: 200 }), (specs, cap) => {
        const a = smallScopeInputs(specs, cap);
        expect(a.length).toBeLessThanOrEqual(cap);
        expect(a.every((x) => argsConform(x, specs))).toBe(true);
        expect(smallScopeInputs(specs, cap)).toEqual(a);
      }),
      { numRuns: runs(100) },
    );
  });
});
