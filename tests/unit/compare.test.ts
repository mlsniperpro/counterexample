import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clipText, displayable, exactReviver, OUTPUT_TEXT_CAP, outputsEqual, showValue } from "@/lib/core/compare";
import { jsonValueArb } from "../arbitraries";

describe("outputsEqual", () => {
  it("is reflexive in every mode", () => {
    fc.assert(
      fc.property(jsonValueArb, (v) => {
        for (const m of ["exact", "unordered", "float"] as const) expect(outputsEqual(v, structuredClone(v), m)).toBe(true);
      }),
    );
  });

  it("unordered ignores the order of a top-level list, exact does not", () => {
    fc.assert(
      fc.property(fc.array(jsonValueArb, { maxLength: 6 }), (xs) => {
        const rev = [...xs].reverse();
        expect(outputsEqual(xs, rev, "unordered")).toBe(true);
        if (JSON.stringify(xs) !== JSON.stringify(rev)) expect(outputsEqual(xs, rev, "exact")).toBe(false);
      }),
    );
    expect(outputsEqual([1, 1, 2], [1, 2, 2], "unordered")).toBe(false);
    expect(outputsEqual([1], [1, 1], "unordered")).toBe(false);
  });

  it("float uses a relative tolerance, recursively", () => {
    expect(outputsEqual(0.1 + 0.2, 0.3, "float")).toBe(true);
    expect(outputsEqual([1e9, 0.3], [1e9 + 1e-3, 0.1 + 0.2], "float")).toBe(true);
    expect(outputsEqual(1, 1.001, "float")).toBe(false);
    expect(outputsEqual([1, 2], [1], "float")).toBe(false);
    expect(outputsEqual(0.3, 0.1 + 0.2, "exact")).toBe(false);
  });

  it("treats null and a missing value the same (JSON has no undefined)", () => {
    expect(outputsEqual([0, null], [0, null])).toBe(true);
    expect(outputsEqual([0, undefined], [0, null])).toBe(true);
    expect(outputsEqual(0, null)).toBe(false);
  });
});

describe("outputsEqual on objects and big integers", () => {
  it("ignores object key order, recursively and in every mode", () => {
    for (const m of ["exact", "unordered", "float"] as const) {
      expect(outputsEqual({ even: 2, odd: 3 }, { odd: 3, even: 2 }, m)).toBe(true);
      expect(outputsEqual([{ a: 1, b: [{ x: 1, y: 2 }] }], [{ b: [{ y: 2, x: 1 }], a: 1 }], m)).toBe(true);
      expect(outputsEqual({ a: 1, b: 2 }, { a: 1, b: 3 }, m)).toBe(false);
    }
    fc.assert(
      fc.property(fc.dictionary(fc.string({ maxLength: 4 }), jsonValueArb, { maxKeys: 6 }), (o) => {
        const reversed = Object.fromEntries(Object.entries(o).reverse());
        expect(outputsEqual(o, reversed)).toBe(true);
      }),
    );
  });

  it("compares big integers by their exact digits, and a number with the same exact value as equal", () => {
    const big = (s: string) => JSON.parse(`[${s}]`, exactReviver)[0];
    expect(outputsEqual(big("999999998000000001"), big("999999998000000000"))).toBe(false);
    expect(outputsEqual(big("999999998000000000"), 999999998000000000)).toBe(true);
    expect(outputsEqual([big("-18446744073709551616")], [big("-18446744073709551616")], "unordered")).toBe(true);
    expect(outputsEqual(big("100000000000000000000"), 1e20, "float")).toBe(true);
    expect(showValue({ n: big("123456789012345678901") })).toBe('{"n":123456789012345678901}');
  });

  it("clips display text with a visible marker, and leaves short text alone", () => {
    expect(clipText("abc")).toBe("abc");
    const long = clipText("x".repeat(5000));
    expect(long.length).toBeLessThanOrEqual(OUTPUT_TEXT_CAP);
    expect(long).toMatch(/\[truncated, 3040 more chars\]$/);
    expect(displayable([1, 2])).toEqual([1, 2]);
    expect(displayable("y".repeat(5000))).toMatch(/truncated/);
  });
});

describe("float mode inside objects", () => {
  it("uses the tolerance on object values too, with keys in any order", () => {
    expect(outputsEqual({ avg: 0.1 + 0.2, n: [1e9] }, { n: [1e9 + 1e-3], avg: 0.3 }, "float")).toBe(true);
    expect(outputsEqual({ avg: 1 }, { avg: 1.001 }, "float")).toBe(false);
    expect(outputsEqual({ a: 1 }, { a: 1, b: 2 }, "float")).toBe(false);
    expect(outputsEqual({ a: 1 }, { b: 1 }, "float")).toBe(false);
  });
});
