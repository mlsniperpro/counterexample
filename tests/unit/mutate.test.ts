import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mutateArgs, mutateValue } from "@/lib/core/mutate";
import { mulberry32 } from "@/lib/core/rng";
import { jsonValueArb } from "../arbitraries";

describe("type-aware mutation", () => {
  it("is deterministic for a seed and never mutates its input", () => {
    fc.assert(
      fc.property(jsonValueArb, fc.integer(), (v, seed) => {
        const before = JSON.stringify(v);
        const a = mutateValue(v, mulberry32(seed));
        expect(mutateValue(v, mulberry32(seed))).toEqual(a);
        expect(JSON.stringify(v)).toBe(before);
      }),
    );
  });

  it("keeps the type of the value it mutates", () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer({ min: -1e6, max: 1e6 }), fc.string(), fc.array(fc.integer())), fc.integer(), (v, seed) => {
        const m = mutateValue(v, mulberry32(seed));
        if (typeof v === "number") expect(Number.isInteger(m)).toBe(true);
        else if (typeof v === "string") expect(typeof m).toBe("string");
        else expect(Array.isArray(m)).toBe(true);
      }),
    );
  });

  it("changes at most one argument", () => {
    fc.assert(
      fc.property(fc.array(jsonValueArb, { minLength: 1, maxLength: 4 }), fc.integer(), (args, seed) => {
        const m = mutateArgs(args, mulberry32(seed));
        expect(m).toHaveLength(args.length);
        expect(m.filter((x, i) => JSON.stringify(x) !== JSON.stringify(args[i])).length).toBeLessThanOrEqual(1);
      }),
    );
    expect(mutateArgs([], mulberry32(1))).toEqual([]);
  });

  it("reaches near-boundary integers and duplicates from a seed", () => {
    const rng = mulberry32(5);
    const ints = new Set(Array.from({ length: 200 }, () => mutateValue(10, rng)));
    for (const x of [9, 11, -10, 0, 20, 5]) expect(ints.has(x)).toBe(true);
    const arrays = Array.from({ length: 200 }, () => mutateValue([1, 2, 3], rng) as number[]);
    expect(arrays.some((a) => new Set(a).size < a.length)).toBe(true);
    expect(arrays.some((a) => a.length < 3)).toBe(true);
  });

  it("leaves non-integer scalars alone", () => {
    expect(mutateValue(1.5, mulberry32(1))).toBe(1.5);
    expect(mutateValue(true, mulberry32(1))).toBe(true);
    expect(mutateValue(null, mulberry32(1))).toBe(null);
  });
});
