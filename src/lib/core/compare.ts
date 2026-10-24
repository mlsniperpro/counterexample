export type CompareMode = "exact" | "unordered" | "float";

function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x === undefined ? null : x));
}

/** Compare two JSON outputs under a problem's comparison mode. */
export function outputsEqual(a: unknown, b: unknown, mode: CompareMode = "exact"): boolean {
  if (mode === "float") return floatEq(a, b);
  if (mode === "unordered" && Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sa = a.map(canon).sort();
    const sb = b.map(canon).sort();
    return sa.every((x, i) => x === sb[i]);
  }
  return canon(a) === canon(b);
}

function floatEq(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => floatEq(x, b[i]));
  return canon(a) === canon(b);
}
