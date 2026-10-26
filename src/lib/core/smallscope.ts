import { argsConform, type TypeSpec } from "./spec";

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

/** Small values of one (non-graph) spec; `top` marks a whole argument rather than an element of one. */
function values(spec: TypeSpec, top: boolean): unknown[] {
  switch (spec.kind) {
    case "int":
      return top ? ints(spec.min, spec.max, true) : ints(spec.min, spec.max, false).slice(0, ELEM_VALUES);
    case "const":
      return [spec.value];
    case "oneOf":
      return spec.options.flatMap((o) => (o.kind === "graph" ? [] : values(o, top)));
    case "string": {
      const alphabet = [...spec.alphabet].slice(0, ELEM_VALUES);
      return sequences(alphabet, spec.len.min, Math.min(spec.len.max, spec.len.min + SMALL_LEN)).map((cs) => cs.join(""));
    }
    case "tuple":
      return product(spec.items.map((it) => (it.kind === "graph" ? [] : values(it, false))), 200);
    case "array": {
      if (spec.of.kind === "graph") return [];
      const elems = values(spec.of, false).slice(0, ELEM_VALUES);
      return sequences(elems, spec.len.min, Math.min(spec.len.max, spec.len.min + SMALL_LEN));
    }
    case "graph":
      return [];
  }
}

/** Every sequence of the given items with length in [minLen, maxLen]. */
function sequences<T>(items: T[], minLen: number, maxLen: number): T[][] {
  const out: T[][] = [];
  let layer: T[][] = [[]];
  for (let len = 0; len <= maxLen; len++) {
    if (len >= minLen) out.push(...layer);
    if (len === maxLen) break;
    layer = layer.flatMap((s) => items.map((x) => [...s, x]));
    if (layer.length > 5000) break;
  }
  return out;
}

/** Graphs with more nodes than this are not "small": the family contributes none for them. */
const SMALL_NODES = 8;

/** Small graphs: few nodes, up to two edges, weights at the extremes and zero. */
function graphs(spec: Extract<TypeSpec, { kind: "graph" }>): unknown[][] {
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

/** Cartesian product, smallest combinations first, stopping at `cap`. */
function product(lists: unknown[][], cap: number): unknown[][] {
  let acc: unknown[][] = [[]];
  for (const list of lists) {
    const next: unknown[][] = [];
    for (const a of acc) {
      for (const x of list) {
        next.push([...a, x]);
        if (next.length >= cap) break;
      }
      if (next.length >= cap) break;
    }
    acc = next;
  }
  return acc;
}

/** Most combinations enumerated before filtering; a bigger space is cut here, and `capped` says so. */
const MAX_ENUMERATED = 20_000;

export type SmallScope = {
  /** At most `cap` argument lists, all within the problem's constraints. */
  inputs: unknown[][];
  /** How many distinct valid small inputs the enumeration produced (the true size when `capped` is false). */
  total: number;
  /** True when the enumeration itself hit its limit, so `total` is a lower bound. */
  capped: boolean;
};

/**
 * Small argument lists for these parameter specs. When there are more than
 * `cap`, they are sampled evenly across the whole enumeration (a stride), not
 * cut off after a prefix: a prefix would cover only the first parameter's
 * smallest values (for binary search, only arrays of length 1 and 2).
 */
export function smallScope(specs: TypeSpec[], cap: number): SmallScope {
  // Each graph spec contributes two arguments (n, edges) as one unit.
  const units = specs.map((s) => (s.kind === "graph" ? graphs(s) : values(s, true).map((v) => [v])));
  const combos = product(units, MAX_ENUMERATED).map((parts) => (parts as unknown[][]).flat(1));
  const seen = new Set<string>();
  const all: unknown[][] = [];
  for (const args of combos) {
    if (!argsConform(args, specs)) continue;
    const key = JSON.stringify(args);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(args);
  }
  const capped = combos.length >= MAX_ENUMERATED;
  if (all.length <= cap) return { inputs: all, total: all.length, capped };
  const inputs = Array.from({ length: cap }, (_, i) => all[Math.floor((i * all.length) / cap)] as unknown[]);
  return { inputs, total: all.length, capped };
}

/** Up to `cap` small argument lists for these parameter specs, all within the problem's constraints. */
export function smallScopeInputs(specs: TypeSpec[], cap: number): unknown[][] {
  return smallScope(specs, cap).inputs;
}
