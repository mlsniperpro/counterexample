import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { smallScopeInputs } from "@/lib/core/smallscope";
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
