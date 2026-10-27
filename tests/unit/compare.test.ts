import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clipText, displayable, exactIntegersSupported, exactReviver, OUTPUT_TEXT_CAP, outputsEqual, showValue } from "@/lib/core/compare";
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

  it("float compares two safe integers exactly, so an off-by-one count is caught at any magnitude", () => {
    expect(outputsEqual(1_000_000_000, 1_000_000_001, "float")).toBe(false);
    expect(outputsEqual([3, 1.5], [3, 1.5000000001], "float")).toBe(true);
    expect(outputsEqual([4, 1.5], [3, 1.5], "float")).toBe(false);
    // An integer against a float near it keeps the tolerance (2.0000000001 is a float answer).
    expect(outputsEqual(2, 2.0000000001, "float")).toBe(true);
    // Above 2^53 every double is an integer, and a float result prints as one: those keep the tolerance.
    expect(outputsEqual(1e20, 1e20 * (1 + 1e-12), "float")).toBe(true);
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

  it("marks integer literals too long for a finite number, so they neither equal each other nor null", () => {
    const parse = (s: string) => JSON.parse(`[${s}]`, exactReviver)[0];
    const a = parse("1" + "0".repeat(400));
    const b = parse("1" + "0".repeat(399) + "7");
    expect(typeof a).toBe("string");
    expect(outputsEqual(a, b)).toBe(false);
    expect(outputsEqual(a, null)).toBe(false);
    expect(outputsEqual(a, parse("1" + "0".repeat(400)))).toBe(true);
    expect(showValue(a)).toBe("1" + "0".repeat(400));
    expect(showValue([parse("-" + "9".repeat(350))])).toBe(`[-${"9".repeat(350)}]`);
    // Plain numbers, floats and exponent forms stay numbers.
    expect(parse("42")).toBe(42);
    expect(parse("1.5")).toBe(1.5);
    expect(parse("1e400")).toBe(Infinity);
  });

  it("float mode judges integers of 309+ digits on their digits (they are Infinity as numbers, and abs(Infinity - Infinity) is NaN)", () => {
    const parse = (s: string) => JSON.parse(`[${s}]`, exactReviver)[0];
    const digits = "1" + "0".repeat(400);
    const other = "1" + "0".repeat(399) + "7";
    expect(outputsEqual(parse(digits), parse(digits), "float")).toBe(true);
    expect(outputsEqual([parse(digits), 2], [parse(digits), 2], "float")).toBe(true);
    expect(outputsEqual({ n: parse(digits) }, { n: parse(digits) }, "float")).toBe(true);
    expect(outputsEqual(parse(digits), parse(other), "float")).toBe(false);
    expect(outputsEqual(parse(digits), null, "float")).toBe(false);
    expect(outputsEqual(parse(digits), 5, "float")).toBe(false);
    expect(outputsEqual(parse("-" + digits), parse(digits), "float")).toBe(false);
    // Two non-finite numbers compare with ===.
    expect(outputsEqual(Infinity, Infinity, "float")).toBe(true);
    expect(outputsEqual(Infinity, -Infinity, "float")).toBe(false);
    // Finite big integers still compare within the float tolerance.
    expect(outputsEqual(parse("100000000000000000000"), parse("100000000000000000001"), "float")).toBe(true);
  });

  it("writes only markers that stand as JSON values, never text inside a string", () => {
    const tricky = { got: '"\u0000int:5', list: ['x,"\u0000int:7"', 'a","\u0000int:8"'], '"\u0000int:3"': 1 };
    const text = showValue(tricky);
    expect(JSON.parse(text)).toEqual(tricky);
    expect(JSON.parse(showValue(tricky, 2))).toEqual(tricky);
    expect(JSON.parse(showValue({ s: '"\u0000int:5' }))).toEqual({ s: '"\u0000int:5' });
  });

  it("prints nested and pretty-printed big integers as digits", () => {
    const big = (s: string) => JSON.parse(`[${s}]`, exactReviver)[0];
    const v = { a: [big("123456789012345678901"), { b: big("-98765432109876543210") }], c: big("100000000000000000000") };
    expect(showValue(v)).toBe('{"a":[123456789012345678901,{"b":-98765432109876543210}],"c":100000000000000000000}');
    const pretty = showValue(v, 2);
    expect(pretty).toContain('"c": 100000000000000000000');
    expect(pretty).toContain("    123456789012345678901,");
    expect(JSON.parse(pretty.replace(/(-?\d{19,})/g, '"$1"'))).toEqual({ a: ["123456789012345678901", { b: "-98765432109876543210" }], c: "100000000000000000000" });
  });

  it("detects whether JSON.parse hands the reviver the source text", () => {
    expect(exactIntegersSupported()).toBe(true);
    // A parser without source-text access (Node 20): the reviver never sees `source`.
    const old = (text: string, reviver: (k: string, v: unknown) => unknown) => JSON.parse(text, (k, v) => reviver(k, v));
    expect(exactIntegersSupported(old)).toBe(false);
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
