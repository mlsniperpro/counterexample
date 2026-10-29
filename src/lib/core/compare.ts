/**
 * How two answers compare: "unordered" ignores the order of the returned list only (its items compare exactly, so an
 * interval's [start, end] keeps its order); "unordered_nested" ignores the order of every list inside it as well
 * (3Sum's triplets, grouped anagrams).
 */
export type CompareMode = "exact" | "unordered" | "unordered_nested" | "float";

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

/**
 * `JSON.parse(text, exactReviver)` without the reviver, which is called on every value and made one process's
 * 1,000,000 characters of results take about 450 ms instead of about 50: integer literals that are not safe
 * integers are rewritten, outside strings, as marker strings, and the rest is a plain parse. A literal with a
 * fraction or an exponent stays a number, as it does under the reviver. Text that is not JSON still throws.
 */
export function parseExact(text: string): unknown {
  const parts: string[] = [];
  let last = 0;
  const n = text.length;
  const digit = (c: number) => c >= 48 && c <= 57;
  // Open brackets, and the last character outside strings and whitespace: a number where an object key belongs is
  // left alone, so JSON.parse refuses it as it would have.
  const open: number[] = [];
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 34) {
      // Skip the string: a backslash escapes the next character.
      for (i++; i < n; i++) {
        const d = text.charCodeAt(i);
        if (d === 92) i++;
        else if (d === 34) break;
      }
      prev = 34;
      continue;
    }
    if (c === 91 || c === 123) open.push(c);
    else if (c === 93 || c === 125) open.pop();
    if (c !== 45 && !digit(c)) {
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) prev = c;
      continue;
    }
    const atKey = prev === 123 || (prev === 44 && open[open.length - 1] === 123);
    prev = 48;
    // One whole number token: -?digits(.digits)?([eE][+-]?digits)?
    let j = c === 45 ? i + 1 : i;
    const intStart = j;
    while (j < n && digit(text.charCodeAt(j))) j++;
    const intEnd = j;
    let integer = true;
    if (j < n && text.charCodeAt(j) === 46) {
      integer = false;
      for (j++; j < n && digit(text.charCodeAt(j)); ) j++;
    }
    if (j < n && (text.charCodeAt(j) === 101 || text.charCodeAt(j) === 69)) {
      integer = false;
      j++;
      if (j < n && (text.charCodeAt(j) === 43 || text.charCodeAt(j) === 45)) j++;
      while (j < n && digit(text.charCodeAt(j))) j++;
    }
    // 16 digits is the shortest unsafe integer; a leading zero is left for JSON.parse to refuse.
    if (integer && !atKey && intEnd - intStart >= 16 && text.charCodeAt(intStart) !== 48) {
      const literal = text.slice(i, j);
      if (!Number.isSafeInteger(Number(literal))) {
        parts.push(text.slice(last, i), JSON.stringify(BIG + literal));
        last = j;
      }
    }
    i = j - 1;
  }
  if (last === 0) return JSON.parse(text);
  parts.push(text.slice(last));
  return JSON.parse(parts.join(""));
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

/**
 * Doubles at or past 2^64 stay numbers: their exact digits (up to 309 of them) cost ~1 s per result of 31,000 `1e300`s
 * to build four times over, and no overflow bug the digits exist to catch lives up there.
 */
const EXACT_DIGITS_BELOW = 2 ** 64;

/** The exact digits of an unsafe integer held as a number, in the same marker form, so number and marker forms compare alike. */
function normalise(x: unknown): unknown {
  if (typeof x === "number" && Number.isInteger(x) && !Number.isSafeInteger(x) && Math.abs(x) < EXACT_DIGITS_BELOW) return BIG + BigInt(x).toString();
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
  if (mode === "unordered_nested") return canonNested(a) === canonNested(b);
  return canon(a) === canon(b) || roundingApart(a, b);
}

/**
 * Whether two values are one answer once floating-point answers are allowed their usual tolerance: the same shape, and
 * every pair of numbers either equal, or finite with at least one not an integer and within FLOAT_TOLERANCE (the
 * judges' "absolute or relative error 1e-6") of each other. A float answer computed another way (a mean summed in
 * another order, a bisection to 1e-7 against math.sqrt) then agrees, whatever the examples looked like, while two
 * integers, and markers carrying exact digits, must match exactly, so an off-by-one or an overflow in the low digits
 * is still a mismatch. Each pair is judged on its own values, so the verdict never depends on which inputs ran first.
 */
function roundingApart(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    if (a === b) return true;
    if (!Number.isFinite(a) || !Number.isFinite(b) || (Number.isInteger(a) && Number.isInteger(b))) return false;
    return Math.abs(a - b) <= FLOAT_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => roundingApart(x, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && roundingApart(a[k], b[k]));
  }
  return canon(a) === canon(b);
}

/** Canonical text with every list's items in sorted order, at any depth. */
function canonNested(v: unknown): string {
  const x = normalise(v);
  if (Array.isArray(x)) return `[${x.map(canonNested).sort().join(",")}]`;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonNested(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(x);
}

const isPlainObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

const isMarker = (x: unknown): x is string => typeof x === "string" && x.startsWith(BIG);

const asFloat = (x: unknown): unknown => (isMarker(x) ? Number(x.slice(BIG.length)) : x);

/** Absolute or relative tolerance for floating-point answers (relative from magnitude 1 up). */
const FLOAT_TOLERANCE = 1e-6;

/** Float mode compares integers below this exactly. */
const EXACT_INT_BELOW = 2 ** 50;

function floatEq(a: unknown, b: unknown): boolean {
  // Markers carry exact digits; integers of 309+ digits are Infinity as numbers, so two different ones (or any two, by abs(Inf - Inf) = NaN) must be judged on their digits.
  if (isMarker(a) && isMarker(b) && (a === b || !Number.isFinite(asFloat(a)) || !Number.isFinite(asFloat(b)))) return a === b;
  const fa = asFloat(a);
  const fb = asFloat(b);
  if (typeof fa === "number" && typeof fb === "number") {
    if (!Number.isFinite(fa) || !Number.isFinite(fb)) return fa === fb;
    // Two integers below 2^50 are an integer answer (a count, an index), where off by one is a bug. From 2^50 on, doubles
    // are spaced 0.25 or more apart, so two summation orders of a float answer can land on neighbouring integers: those
    // keep the tolerance.
    if (Number.isInteger(fa) && Number.isInteger(fb) && Math.max(Math.abs(fa), Math.abs(fb)) < EXACT_INT_BELOW) return fa === fb;
    return Math.abs(fa - fb) <= FLOAT_TOLERANCE * Math.max(1, Math.abs(fa), Math.abs(fb));
  }
  if (Array.isArray(fa) && Array.isArray(fb)) return fa.length === fb.length && fa.every((x, i) => floatEq(x, fb[i]));
  if (isPlainObject(fa) && isPlainObject(fb)) {
    const ka = Object.keys(fa).sort();
    const kb = Object.keys(fb).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && floatEq(fa[k], fb[k]));
  }
  return canon(a) === canon(b);
}

/** True when a JSON value holds a number that is not an integer (an average, a probability). */
export function hasFraction(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v) && !Number.isInteger(v);
  if (Array.isArray(v)) return v.some(hasFraction);
  if (v !== null && typeof v === "object") return Object.values(v).some(hasFraction);
  return false;
}
