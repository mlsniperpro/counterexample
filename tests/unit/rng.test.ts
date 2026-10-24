import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { hashString, mulberry32, pick, randInt } from "@/lib/core/rng";

describe("rng", () => {
  it("mulberry32 is deterministic and in [0, 1)", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = mulberry32(seed);
        const b = mulberry32(seed);
        for (let i = 0; i < 20; i++) {
          const x = a();
          expect(x).toBe(b());
          expect(x >= 0 && x < 1).toBe(true);
        }
      }),
    );
  });

  it("randInt stays inside [min, max] and returns min for empty ranges", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: -1e9, max: 1e9 }), fc.integer({ min: 0, max: 1e9 }), (seed, min, width) => {
        const r = mulberry32(seed);
        const x = randInt(r, min, min + width);
        expect(Number.isInteger(x) && x >= min && x <= min + width).toBe(true);
        expect(randInt(r, min, min - 1)).toBe(min);
      }),
    );
  });

  it("hashString is a stable 32-bit FNV-1a", () => {
    expect(hashString("")).toBe(0x811c9dc5);
    expect(hashString("a")).toBe(0xe40c292c);
    fc.assert(
      fc.property(fc.string(), (s) => {
        const h = hashString(s);
        expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
        expect(hashString(s)).toBe(h);
      }),
    );
  });

  it("pick returns a member and refuses an empty list", () => {
    fc.assert(
      fc.property(fc.integer(), fc.array(fc.integer(), { minLength: 1 }), (seed, xs) => {
        expect(xs).toContain(pick(mulberry32(seed), xs));
      }),
    );
    expect(() => pick(mulberry32(1), [])).toThrow(RangeError);
  });
});
