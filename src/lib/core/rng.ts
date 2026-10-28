/** Deterministic PRNG (mulberry32). Same seed, same inputs, on every machine. */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string, used to derive per-family seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function randInt(rng: Rng, min: number, max: number): number {
  if (max < min) return min;
  const span = max - min + 1;
  // One draw has 32 random bits: over a wider range that would leave the low bits constant (every value even).
  if (span > 2 ** 32) return Math.min(max, min + Math.floor((rng() * 2 ** 21 + rng()) * (span / 2 ** 21)));
  return min + Math.floor(rng() * span);
}

/** A uniformly random element of a non-empty list. */
export function pick<T>(rng: Rng, xs: readonly T[]): T {
  if (xs.length === 0) throw new RangeError("pick from an empty list");
  return xs[randInt(rng, 0, xs.length - 1)] as T;
}
