export type CompareMode = "exact" | "unordered" | "float";

/**
 * Integers beyond 2^53 cannot be held exactly in a JS number, so the harness
 * output parser keeps them as marker strings carrying their exact digits
 * (see `exactReviver`). Without this, two answers that differ only in their
 * low digits (the overflow bugs this tool exists to find) would compare equal.
 */
const BIG = "\u0000int:";
/** A marker only counts where a JSON value stands (after `[`, `,`, `:` or at the start, before `,`, `]`, `}` or the end, so never an object key): a quote inside a string is always escaped, so text like "\"\u0000int:5" never matches. */
const BIG_RE = /(^|[[,:]\s*)"\\u0000int:(-?\d+)"(?=\s*(?:[,\]}]|$))/g;

/**
 * JSON.parse reviver: unsafe integer literals become exact marker strings, also
 * those too long for a finite number (309+ digits parse to Infinity, and would
 * otherwise equal each other and null). Needs source-text access (Node 21+);
 * without it values stay numbers, see `exactIntegersSupported`.
 */
export function exactReviver(_key: string, value: unknown, ctx?: { source?: string }): unknown {
  if (typeof value === "number" && !Number.isSafeInteger(value) && ctx?.source && /^-?\d+$/.test(ctx.source)) {
    return BIG + ctx.source;
  }
  return value;
}

let exactSupported: boolean | undefined;

/**
 * Whether this runtime's JSON.parse hands the reviver the source text, which
 * exact big integers need (Node 21+). Checked once per process; `parse` is
 * injectable for tests and then bypasses the cached answer.
 */
export function exactIntegersSupported(parse: (text: string, reviver: typeof exactReviver) => unknown = JSON.parse): boolean {
  const probe = () => (parse("[9007199254740993]", exactReviver) as unknown[])[0] === `${BIG}9007199254740993`;
  if (parse !== JSON.parse) return probe();
  return (exactSupported ??= probe());
}

/** The exact digits of an unsafe integer held as a number, in the same marker form, so number and marker forms compare alike. */
function normalise(x: unknown): unknown {
  if (typeof x === "number" && Number.isInteger(x) && !Number.isSafeInteger(x)) return BIG + BigInt(x).toString();
  return x === undefined ? null : x;
}

/** Canonical text: object keys sorted (insertion order is not part of a JSON value), big integers exact. */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x) => {
    const y = normalise(x);
    if (y && typeof y === "object" && !Array.isArray(y)) {
      const o = y as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    }
    return y;
  });
}

/** JSON text for display and for every JSON the app writes out (stream, trace, report files), with big integers written as plain digits. */
export function showValue(v: unknown, space?: number): string {
  const s = JSON.stringify(v, (_k, x) => normalise(x), space);
  return s === undefined ? "undefined" : s.replace(BIG_RE, "$1$2");
}

/** Longest output text kept for display, traces, reports and prompts; a solution can print megabytes. */
export const OUTPUT_TEXT_CAP = 2000;

/** Clip display text to OUTPUT_TEXT_CAP, marking the cut. */
export function clipText(s: string, cap = OUTPUT_TEXT_CAP): string {
  if (s.length <= cap) return s;
  const keep = cap - 40;
  return `${s.slice(0, keep)} [truncated, ${s.length - keep} more chars]`;
}

/** A value whose display text fits the cap, else its clipped display text (a string). Comparison always uses the full value. */
export function displayable(v: unknown): unknown {
  const text = showValue(v);
  return text.length <= OUTPUT_TEXT_CAP ? v : clipText(text);
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

const isPlainObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

const asFloat = (x: unknown): unknown => (typeof x === "string" && x.startsWith(BIG) ? Number(x.slice(BIG.length)) : x);

function floatEq(a: unknown, b: unknown): boolean {
  const fa = asFloat(a);
  const fb = asFloat(b);
  if (typeof fa === "number" && typeof fb === "number") {
    return Math.abs(fa - fb) <= 1e-6 * Math.max(1, Math.abs(fa), Math.abs(fb));
  }
  if (Array.isArray(fa) && Array.isArray(fb)) return fa.length === fb.length && fa.every((x, i) => floatEq(x, fb[i]));
  if (isPlainObject(fa) && isPlainObject(fb)) {
    const ka = Object.keys(fa).sort();
    const kb = Object.keys(fb).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && floatEq(fa[k], fb[k]));
  }
  return canon(fa) === canon(fb);
}
