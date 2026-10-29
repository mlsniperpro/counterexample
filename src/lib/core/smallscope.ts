import { argsConform, fanOut, jsonValues, type GraphSpec, type TypeSpec } from "./spec";

/**
 * Bounded-exhaustive ("small scope") inputs: every combination of small
 * values of the declared parameter types, up to a cap. Most bugs have a small
 * counterexample (the small scope hypothesis behind Alloy), and enumerating
 * the small cases finds the ones random sampling skips (for example x = 5 out
 * of [0, 2^31 - 1]). Values outside the problem's constraints are filtered out.
 */

/** Integers tried for an int parameter: all of a small range, else 0..SMALL_INT around zero plus the bounds. */
const SMALL_INT = 24;
/** Longest arrays and strings enumerated. */
const SMALL_LEN = 3;
/** Distinct element values per array or string position. */
const ELEM_VALUES = 3;

function ints(min: number, max: number, many: boolean): number[] {
  if (max - min <= (many ? 64 : 4)) return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const span = many ? SMALL_INT : 2;
  const near = Array.from({ length: 2 * span + 1 }, (_, i) => i - span);
  return [...new Set([...near, min, min + 1, max - 1, max])].filter((v) => v >= min && v <= max).sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
}

/** Values a tuple takes from each of its items: it spreads over at most TUPLE_COMBOS combinations of them. */
const TUPLE_COMBOS = 200;
/** Values built for one tuple item before TUPLE_COMBOS of them are picked evenly (not a prefix, which would fix its first elements). */
const TUPLE_ITEM_VALUES = 5000;
/** Scalars all the sequences of one smallScope call may hold together (split evenly between its parameters), however many options and items a spec nests. */
const MAX_SCALARS = 2_000_000;

/** What is left of one smallScope call's MAX_SCALARS. */
type Budget = { left: number };

/** The lists' items taken in turn: the first of each, then the second of each, and so on. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i] as T);
  return out;
}

/** `n` of `xs`, evenly spread over it and in order (all of it when it has at most `n`). */
const evenly = <T>(xs: T[], n: number): T[] => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)] as T));

/**
 * Small values of one (non-graph) spec; `top` marks a whole argument rather
 * than an element of one. `limit` is how many the caller uses: nested values
 * (array elements, tuple items) are cut while they are built, never built in
 * full and then sliced, so a tuple of arrays of long arrays stays cheap. All
 * sequences built share one `budget` of scalars.
 */
function values(spec: TypeSpec, top: boolean, budget: Budget, limit = Infinity): unknown[] {
  switch (spec.kind) {
    case "int":
      return (top ? ints(spec.min, spec.max, true) : ints(spec.min, spec.max, false).slice(0, ELEM_VALUES)).slice(0, limit);
    case "const":
      return [spec.value];
    case "oneOf":
      // Round robin over the options, so a cut to a few element values still holds each kind (an int and a null).
      return interleave(spec.options.map((o) => (o.kind === "graph" ? [] : values(o, top, budget, limit)))).slice(0, limit);
    case "string": {
      const alphabet = [...spec.alphabet].slice(0, ELEM_VALUES);
      return sequences(alphabet, spec.len.min, Math.min(spec.len.max, spec.len.min + SMALL_LEN), limit, budget).map((cs) => cs.join(""));
    }
    case "tuple":
      return spread(spec.items.map((it) => (it.kind === "graph" ? [] : evenly(values(it, false, budget, TUPLE_ITEM_VALUES), TUPLE_COMBOS))), TUPLE_COMBOS).combos.slice(0, limit);
    case "array": {
      if (spec.of.kind === "graph") return [];
      const elems = values(spec.of, false, budget, ELEM_VALUES);
      return sequences(elems, spec.len.min, Math.min(spec.len.max, spec.len.min + SMALL_LEN), limit, budget);
    }
    case "graph":
      return [];
  }
}

/** Longest layer of sequences that grows into the next one; a longer layer is cut to its first sequences first. */
const MAX_LAYER = 5000;
/** Elements written per sequence length, so a long minimum length (a fixed-length array of 10,000) stays linear. */
const MAX_ELEMS_PER_LEN = 200_000;

/**
 * Every sequence of the given items with length in [minLen, maxLen], shortest
 * first and in lexicographic order of item positions within a length. A length
 * whose layer would grow from more than MAX_LAYER shorter sequences keeps the
 * first MAX_LAYER × |items| of them, as growing a cut layer would. Each length
 * is built directly as base-|items| counters, never from the layers below it,
 * and keeps at most MAX_ELEMS_PER_LEN / length sequences. At most `limit` in all,
 * shortest first. With a `budget`, each length also keeps only what is left of
 * it (at least one sequence), and spends it.
 */
export function sequences<T>(items: T[], minLen: number, maxLen: number, limit = Infinity, budget?: Budget): T[][] {
  const out: T[][] = [];
  const k = items.length;
  for (let len = minLen; len <= maxLen && out.length < limit; len++) {
    if (len === 0) {
      out.push([]);
      continue;
    }
    if (k === 0) break;
    const layer = k * Math.min(k ** (len - 1), MAX_LAYER);
    const count = Math.min(layer, Math.max(1, Math.floor(MAX_ELEMS_PER_LEN / len)), limit - out.length, budget ? Math.max(1, Math.floor(budget.left / len)) : Infinity);
    if (budget) budget.left -= count * len;
    for (let i = 0; i < count; i++) {
      const seq = new Array<T>(len);
      let rest = i;
      for (let p = len - 1; p >= 0; p--) {
        seq[p] = items[rest % k] as T;
        rest = Math.floor(rest / k);
      }
      out.push(seq);
    }
  }
  return out;
}

/** Graphs with more nodes than this are not "small": the family contributes none for them. */
const SMALL_NODES = 8;

/** Small graphs: few nodes, up to two edges, weights at the extremes and zero. Empty when no graph of the spec is small. */
function graphs(spec: GraphSpec): unknown[][] {
  const out: unknown[][] = [];
  if (spec.n.min > SMALL_NODES) return out;
  const weights = [...new Set([spec.weight.min, 0, spec.weight.max])].filter((w) => w >= spec.weight.min && w <= spec.weight.max);
  for (let n = spec.n.min; n <= Math.min(spec.n.max, spec.n.min + 2, SMALL_NODES); n++) {
    const pairs: [number, number][] = [];
    for (let u = 0; u < n; u++) for (let v = 0; v < n; v++) if (spec.dag ? u < v : true) pairs.push([u, v]);
    const edges = pairs.flatMap(([u, v]) => weights.map((w) => [u, v, w]));
    for (const es of sequences(edges, spec.m.min, Math.min(spec.m.max, 2))) out.push([n, es]);
  }
  return out;
}

/** Most edges a stand-in graph may carry: it is repeated in every combination, so it must stay small. */
const DEFAULT_GRAPH_EDGES = 8;

/**
 * The smallest valid graph of a spec (fewest nodes, fewest edges, lowest
 * weight), or none when it is not small or the spec admits no graph. Stands in
 * for a graph parameter that has no small instances, so the other parameters'
 * small inputs are still tried instead of the whole family going empty.
 */
function defaultGraph(spec: GraphSpec): unknown[][] {
  if (spec.m.min > DEFAULT_GRAPH_EDGES) return [];
  const n = Math.max(spec.n.min, spec.m.min > 0 ? (spec.dag ? 2 : 1) : 0);
  if (n > spec.n.max) return [];
  return [[n, Array.from({ length: spec.m.min }, () => [0, spec.dag ? 1 : 0, spec.weight.min])]];
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));

/** The smallest step of at least `target` that shares no factor with any radix, so striding by it reaches every value of each digit instead of aliasing onto a few. */
function coprimeStep(target: bigint, radices: bigint[]): bigint {
  let step = target < 1n ? 1n : target;
  while (radices.some((r) => gcd(step, r) !== 1n)) step++;
  return step;
}

/**
 * Up to `count` combinations of the Cartesian product of `lists`, spread over
 * the whole product: every combination, smallest first, when it has at most
 * `count`, else the combinations at a stride across it. The product is never
 * built: an index is decoded in mixed radix (the first list is the most
 * significant digit, so it changes slowest). `space` is the product's size.
 */
function spread(lists: unknown[][], count: number): { combos: unknown[][]; space: number; sampled: boolean; radices: bigint[] } {
  const radices = lists.map((l) => BigInt(l.length));
  const space = radices.reduce((a, r) => a * r, 1n);
  const sampled = space > BigInt(count);
  const n = sampled ? count : Number(space);
  // A stride coprime to every radix visits distinct indices, and may wrap around the space more than once.
  const step = sampled ? coprimeStep((space + BigInt(count) - 1n) / BigInt(count), radices) : 1n;
  const combos: unknown[][] = [];
  for (let j = 0; j < n; j++) {
    let rest = (BigInt(j) * step) % space;
    const combo: unknown[] = new Array(lists.length);
    for (let k = lists.length - 1; k >= 0; k--) {
      const radix = radices[k] as bigint;
      combo[k] = (lists[k] as unknown[])[Number(rest % radix)];
      rest /= radix;
    }
    combos.push(combo);
  }
  return { combos, space: Number(space), sampled, radices };
}

/** Most combinations enumerated before filtering; a bigger space is sampled at a stride, and `capped` says so. */
const MAX_ENUMERATED = 20_000;
/** Most scalar values in the enumerated combinations, so long fixed-length inputs are enumerated fewer at a time. */
const MAX_ENUMERATED_VALUES = 1_000_000;

/** Sizes of arrays already measured: small values share sub-arrays (every sequence of a fixed-length grid reuses the same rows), so each is walked once. */
const sizes = new WeakMap<object, number>();

/** Scalar values in a small value (a string counts its characters). */
function size(v: unknown): number {
  if (typeof v === "string") return 1 + v.length;
  // An object (from a const) counts what it holds, keys included.
  if (v !== null && typeof v === "object" && !Array.isArray(v)) return 1 + jsonValues(v);
  if (!Array.isArray(v)) return 1;
  const known = sizes.get(v);
  if (known !== undefined) return known;
  const n = v.reduce((a: number, x) => a + size(x), 1);
  sizes.set(v, n);
  return n;
}

export type SmallScope = {
  /** At most `cap` argument lists, all within the problem's constraints. */
  inputs: unknown[][];
  /** How many distinct valid small inputs were found (the true size when `capped` is false). */
  total: number;
  /** True when the space of combinations was larger than MAX_ENUMERATED (fewer for long inputs), so only a stride sample of it was looked at and `total` is a lower bound. */
  capped: boolean;
  /** How many combinations of small values there are in all, before the constraints filter them. */
  space: number;
  /** True when a graph parameter had no small instance and its smallest valid graph stands in for it. */
  standIn: boolean;
};

/**
 * `cap` of `all`, spread over the whole list, in list order. A plain stride
 * (every len/cap-th) is enough for a list that is the whole enumeration. A
 * list that is itself a stride sample is picked at a step coprime to the
 * radices too: otherwise a step that is a multiple of a parameter's radix
 * (every 200th of a list over 20 values) would repeat one value of it.
 */
function pick(all: unknown[][], cap: number, radices: bigint[]): unknown[][] {
  if (radices.length === 0 || all.length < 2 * cap) return Array.from({ length: cap }, (_, i) => all[Math.floor((i * all.length) / cap)] as unknown[]);
  const len = BigInt(all.length);
  const step = coprimeStep((len + BigInt(cap) - 1n) / BigInt(cap), [...radices, len]);
  const at = Array.from({ length: cap }, (_, i) => Number((BigInt(i) * step) % len)).sort((a, b) => a - b);
  return at.map((i) => all[i] as unknown[]);
}

/**
 * Small argument lists for these parameter specs. When there are more than
 * `cap`, they are sampled evenly across the whole space of combinations (a
 * stride, decoded from the index), not cut off after a prefix: a prefix would
 * cover only the first parameter's smallest values (for binary search, only
 * arrays of length 1 and 2).
 */
export function smallScope(specs: TypeSpec[], cap: number): SmallScope {
  // Each graph spec contributes two arguments (n, edges) as one unit. A graph with no small instances is
  // replaced by its smallest valid graph when there is something else to vary; alone it contributes nothing.
  let standIn = false;
  const units = specs.map((s) => {
    // Each parameter gets its own share, so long earlier parameters cannot starve a small later one.
    if (s.kind !== "graph") return values(s, true, { left: Math.floor(MAX_SCALARS / specs.length) }).map((v) => [v]);
    const small = graphs(s);
    if (small.length || specs.length === 1) return small;
    const stand = defaultGraph(s);
    standIn ||= stand.length > 0;
    return stand;
  });
  // Checking a combination costs its size times the alternatives a oneOf makes `conforms` try, so that is what the
  // enumeration budget counts (the same as its size when the specs have no oneOf).
  const perCombo = units.reduce((a, unit, i) => a + (specs[i] ? fanOut(specs[i]) : 1) * unit.reduce((m: number, parts) => Math.max(m, size(parts)), 0), 0);
  const { combos, space, sampled, radices } = spread(units, Math.max(1, Math.min(MAX_ENUMERATED, Math.floor(MAX_ENUMERATED_VALUES / Math.max(1, perCombo)))));
  const seen = new Set<string>();
  const all: unknown[][] = [];
  for (const parts of combos) {
    const args = (parts as unknown[][]).flat(1);
    if (!argsConform(args, specs)) continue;
    const key = JSON.stringify(args);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(args);
  }
  if (all.length <= cap) return { inputs: all, total: all.length, capped: sampled, space, standIn };
  return { inputs: pick(all, cap, sampled ? radices : []), total: all.length, capped: sampled, space, standIn };
}

/** Up to `cap` small argument lists for these parameter specs, all within the problem's constraints. */
export function smallScopeInputs(specs: TypeSpec[], cap: number): unknown[][] {
  return smallScope(specs, cap).inputs;
}
