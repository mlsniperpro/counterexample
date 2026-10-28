import { createHash } from "node:crypto";
import { SPEC_LIMITS } from "./spec";

/**
 * Generic delta debugging over structured (JSON) inputs: arrays, strings,
 * integers, tuples and graphs as edge lists. Candidates are produced from
 * the current failing input, filtered by a validity predicate (the problem's
 * constraints) and by a well-founded size measure (so shrinking always
 * terminates), then tested in batches. The first candidate that still fails
 * becomes the new current input.
 */

/** Size measure: [number of nodes, sum of |ints| plus char codes]. Lexicographic. */
export function measure(v: unknown): [number, number] {
  if (typeof v === "number") return [1, Math.abs(v)];
  if (typeof v === "string") {
    let s = 0;
    for (const c of v) s += c.charCodeAt(0);
    return [1 + v.length, s];
  }
  if (Array.isArray(v)) {
    let nodes = 1;
    let mag = 0;
    for (const x of v) {
      const [a, b] = measure(x);
      nodes += a;
      mag += b;
    }
    return [nodes, mag];
  }
  // An object counts its keys and values, so the scan budget and the size order see what it holds.
  if (v !== null && typeof v === "object") {
    let nodes = 1;
    let mag = 0;
    for (const [k, x] of Object.entries(v)) {
      const [a, b] = measure(x);
      nodes += k.length + a;
      mag += b;
    }
    return [nodes, mag];
  }
  return [1, 0];
}

export function smaller(a: unknown, b: unknown): boolean {
  const [a0, a1] = measure(a);
  const [b0, b1] = measure(b);
  return a0 < b0 || (a0 === b0 && a1 < b1);
}

function intCandidates(x: number): number[] {
  if (x === 0) return [];
  // Small magnitudes are tried exhaustively (cheap, and escapes local minima); large ones by halving.
  const lim = Math.min(Math.abs(x), 65);
  const small = Array.from({ length: Math.max(0, lim - 1) }, (_, k) => (k + 1) * Math.sign(x));
  const out = [0, ...small];
  // x - x/2, x - x/4, ..., x - 1: a binary search towards the smallest failing magnitude.
  for (let d = Math.trunc(x / 2); d !== 0; d = Math.trunc(d / 2)) out.push(x - d);
  out.push(x - Math.sign(x));
  return [...new Set(out)].filter((y) => y !== x);
}

/**
 * ddmin-style removals: drop aligned chunks of size n/2, n/4, ..., then every
 * contiguous run of length 2 and 1 at any offset. The unaligned small runs
 * matter for paired structure: in "({())}" the failing core "({)}" is reached
 * only by removing the "()" at offset 2, which no aligned chunk covers. The
 * result is 1-minimal for single and adjacent-pair removals, at O(n)
 * extra candidates per round.
 */
function* removals<T>(xs: T[]): Generator<T[]> {
  const n = xs.length;
  for (let size = Math.floor(n / 2); size > 2; size = Math.floor(size / 2)) {
    for (let start = 0; start < n; start += size) {
      yield [...xs.slice(0, start), ...xs.slice(start + size)];
    }
  }
  for (const size of [2, 1]) {
    for (let start = 0; start + size <= n; start++) {
      yield [...xs.slice(0, start), ...xs.slice(start + size)];
    }
  }
}

/** All one-step simplifications of a value, most aggressive first. */
export function* candidates(v: unknown): Generator<unknown> {
  if (typeof v === "number") {
    yield* intCandidates(v);
    return;
  }
  if (typeof v === "string") {
    const chars = [...v];
    for (const r of removals(chars)) yield r.join("");
    const minChar = chars.reduce((m, c) => (c < m ? c : m), chars[0] ?? "");
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] !== minChar) yield [...chars.slice(0, i), minChar, ...chars.slice(i + 1)].join("");
    }
    return;
  }
  if (Array.isArray(v)) {
    if (v.length > 0) yield* removals(v);
    for (let i = 0; i < v.length; i++) {
      for (const c of candidates(v[i])) yield [...v.slice(0, i), c, ...v.slice(i + 1)];
    }
  }
}

/**
 * An (n, edges) argument pair the generators could have made: n within the
 * graph limit and every edge's endpoints nodes of it. Anything else (an int
 * followed by a list of pairs, say) is shrunk as plain values, so a huge n
 * never drives a per-node loop.
 */
const isGraph = (n: unknown, v: unknown): v is number[][] =>
  typeof n === "number" &&
  Number.isInteger(n) &&
  n >= 1 &&
  n <= SPEC_LIMITS.maxNodes &&
  Array.isArray(v) &&
  v.every((e) => Array.isArray(e) && e.length >= 2 && e.every((x) => Number.isInteger(x)) && e[0] < n && e[1] < n && e[0] >= 0 && e[1] >= 0);

/**
 * Graph-aware step for an (n, edges) argument pair: delete nodes that no edge
 * touches and renumber the nodes above them. Bulk drops come first (all
 * isolated nodes, then the upper half of them), so a 1000-node graph with a
 * few edges shrinks in a handful of rounds instead of one node per round;
 * single-node drops follow for the cases where a bulk drop loses the failure.
 * Node 0 is kept (it is often the source).
 */
function* dropIsolatedNodes(n: number, edges: number[][]): Generator<[number, number[][]]> {
  const used = new Set(edges.flatMap((e) => e.slice(0, 2)));
  const isolated: number[] = [];
  for (let k = n - 1; k >= 1; k--) if (!used.has(k)) isolated.push(k);
  const without = (drop: number[]): [number, number[][]] => {
    const gone = new Set(drop);
    // A node's new label is its old one minus the dropped nodes below it.
    const below: number[] = [];
    let removed = 0;
    for (let x = 0; x < n; x++) {
      below.push(removed);
      if (gone.has(x)) removed++;
    }
    const relabel = (x: number) => (Number.isInteger(x) && x >= 0 && x < n ? x - (below[x] ?? 0) : x);
    return [n - drop.length, edges.map((e) => [...e.slice(0, 2).map(relabel), ...e.slice(2)])];
  };
  if (isolated.length > 1) yield without(isolated);
  if (isolated.length > 2) yield without(isolated.slice(0, Math.floor(isolated.length / 2)));
  for (const k of isolated) yield without([k]);
}

/** Candidates for an argument list: shrink one argument at a time. */
export function* argCandidates(args: unknown[]): Generator<unknown[]> {
  for (let i = 0; i + 1 < args.length; i++) {
    const n = args[i];
    const edges = args[i + 1];
    if (typeof n === "number" && isGraph(n, edges)) {
      for (const [n2, e2] of dropIsolatedNodes(n, edges)) yield [...args.slice(0, i), n2, e2, ...args.slice(i + 2)];
    }
  }
  for (let i = 0; i < args.length; i++) {
    for (const c of candidates(args[i])) yield [...args.slice(0, i), c, ...args.slice(i + 1)];
  }
}

type ShrinkOptions = {
  isValid: (args: unknown[]) => boolean;
  /** Returns, for each candidate, whether it still reproduces the failure. */
  stillFails: (batch: unknown[][]) => Promise<boolean[]>;
  batchSize?: number;
  maxEvals?: number;
  /** Most values looked at in candidates over the whole shrink, tested or skipped (a candidate costs its size to build and check). */
  maxScan?: number;
  /** Stops scanning (with the input so far, marked exhausted) once aborted. */
  signal?: AbortSignal;
};

/** Values scanned between yields to the event loop, so skipping many invalid candidates never blocks it for long. */
const SCAN_SLICE = 100_000;

type ShrinkResult = { minimal: unknown[]; steps: number; evals: number; exhausted: boolean };

export async function shrink(start: unknown[], opts: ShrinkOptions): Promise<ShrinkResult> {
  const batchSize = opts.batchSize ?? 64;
  const maxEvals = opts.maxEvals ?? 5000;
  const maxScan = opts.maxScan ?? 100_000_000;
  let current = start;
  let steps = 0;
  let evals = 0;
  let scanned = 0;
  let nextYield = SCAN_SLICE;
  for (;;) {
    let improved = false;
    const [curNodes, curMag] = measure(current);
    const seen = new Set<string>();
    let batch: unknown[][] = [];
    const flush = async (): Promise<boolean> => {
      if (batch.length === 0) return false;
      const res = await opts.stillFails(batch);
      evals += batch.length;
      const idx = res.findIndex(Boolean);
      const hit = idx >= 0 ? batch[idx] : undefined;
      batch = [];
      if (hit) {
        current = hit;
        steps++;
        return true;
      }
      return false;
    };
    for (const c of argCandidates(current)) {
      const [nodes, mag] = measure(c);
      scanned += nodes;
      if (scanned >= nextYield) {
        nextYield = scanned + SCAN_SLICE;
        await new Promise((resolve) => setImmediate(resolve));
        if (opts.signal?.aborted) return { minimal: current, steps, evals, exhausted: true };
        if (scanned >= maxScan) {
          await flush();
          return { minimal: current, steps, evals, exhausted: true };
        }
      }
      if (nodes > curNodes || (nodes === curNodes && mag >= curMag)) continue;
      // A digest, not the JSON itself: a round can see thousands of candidates of a 100,000-value input (about 1 GB of keys).
      const key = createHash("sha1").update(JSON.stringify(c)).digest("base64");
      if (seen.has(key) || !opts.isValid(c)) continue;
      seen.add(key);
      batch.push(c);
      if (evals + batch.length >= maxEvals) {
        await flush();
        return { minimal: current, steps, evals, exhausted: true };
      }
      if (batch.length >= batchSize && (await flush())) {
        improved = true;
        break;
      }
    }
    if (!improved) improved = await flush();
    if (!improved) return { minimal: current, steps, evals, exhausted: false };
  }
}
