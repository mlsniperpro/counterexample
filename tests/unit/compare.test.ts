import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { outputsEqual } from "@/lib/core/compare";
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
