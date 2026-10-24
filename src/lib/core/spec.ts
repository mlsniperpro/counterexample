import { randInt, type Rng } from "./rng";

/**
 * A small, safe DSL for input types. Problems declare their parameters with it,
 * and the fast model writes adversarial generator families in it (as JSON), so
 * model output is interpreted, never executed.
 */
export type Range = { min: number; max: number };

export type IntSpec = {
  kind: "int";
  min: number;
  max: number;
  /** "edges" favours min, max, 0 and +-1; "small" favours values near 0. */
  bias?: "uniform" | "edges" | "small";
};
export type ArraySpec = {
  kind: "array";
  of: TypeSpec;
  len: Range;
  sorted?: "asc" | "desc";
  distinct?: boolean;
  /** Draw elements from a pool of this many values, to force duplicates. */
  pool?: number;
};
export type StringSpec = { kind: "string"; alphabet: string; len: Range };
export type TupleSpec = { kind: "tuple"; items: TypeSpec[]; nondecreasing?: boolean };
export type ConstSpec = { kind: "const"; value: unknown };
export type OneOfSpec = { kind: "oneOf"; options: TypeSpec[] };
/** Expands to two arguments: n and an edge list of [u, v, w] triples. */
export type GraphSpec = {
  kind: "graph";
  n: Range;
  m: Range;
  weight: Range;
  /** Only edges u < v, so there are never cycles (and never negative cycles). */
  dag?: boolean;
};

export type TypeSpec =
  | IntSpec
  | ArraySpec
  | StringSpec
  | TupleSpec
  | ConstSpec
  | OneOfSpec
  | GraphSpec;

export type Param = { name: string; type: TypeSpec };

export function arity(spec: TypeSpec): number {
  return spec.kind === "graph" ? 2 : 1;
}

export function genValue(spec: Exclude<TypeSpec, GraphSpec>, rng: Rng): unknown {
  switch (spec.kind) {
    case "int":
      return genInt(spec, rng);
    case "const":
      return structuredClone(spec.value);
    case "oneOf": {
      const opt = spec.options[randInt(rng, 0, spec.options.length - 1)];
      if (opt.kind === "graph") throw new Error("graph is not allowed inside oneOf");
      return genValue(opt, rng);
    }
    case "string": {
      const n = randInt(rng, spec.len.min, spec.len.max);
      let s = "";
      for (let i = 0; i < n; i++) s += spec.alphabet[randInt(rng, 0, spec.alphabet.length - 1)];
      return s;
    }
    case "tuple": {
      const out = spec.items.map((it) => {
        if (it.kind === "graph") throw new Error("graph is not allowed inside tuple");
        return genValue(it, rng);
      });
      if (spec.nondecreasing) (out as number[]).sort((a, b) => a - b);
      return out;
    }
    case "array":
      return genArray(spec, rng);
  }
}

function genInt(spec: IntSpec, rng: Rng): number {
  const { min, max } = spec;
  if (spec.bias === "edges" && rng() < 0.6) {
    const picks = [min, max, min + 1, max - 1, 0, 1, -1].filter((v) => v >= min && v <= max);
    return picks[randInt(rng, 0, picks.length - 1)];
  }
  if (spec.bias === "small" && rng() < 0.7) {
    const lo = Math.max(min, -10);
    const hi = Math.min(max, 10);
    if (lo <= hi) return randInt(rng, lo, hi);
  }
  return randInt(rng, min, max);
}

function genArray(spec: ArraySpec, rng: Rng): unknown[] {
  if (spec.of.kind === "graph") throw new Error("graph is not allowed inside array");
  const of = spec.of;
  const n = randInt(rng, spec.len.min, spec.len.max);
  let pool: unknown[] | undefined;
  if (spec.pool && spec.pool > 0) pool = Array.from({ length: spec.pool }, () => genValue(of, rng));
  const out: unknown[] = [];
  const seen = new Set<string>();
  let attempts = 0;
  while (out.length < n && attempts < n * 20 + 50) {
    attempts++;
    const v = pool ? pool[randInt(rng, 0, pool.length - 1)] : genValue(of, rng);
    if (spec.distinct) {
      const key = JSON.stringify(v);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(v);
  }
  if (spec.sorted) {
    out.sort(compareJson);
    if (spec.sorted === "desc") out.reverse();
  }
  return out;
}

function genGraph(spec: GraphSpec, rng: Rng): [number, number[][]] {
  const n = randInt(rng, spec.n.min, spec.n.max);
  const m = randInt(rng, spec.m.min, spec.m.max);
  const edges: number[][] = [];
  if (n >= 1) {
    for (let i = 0; i < m; i++) {
      let u = randInt(rng, 0, n - 1);
      let v = randInt(rng, 0, n - 1);
      if (spec.dag) {
        if (u === v) continue;
        if (u > v) [u, v] = [v, u];
      }
      edges.push([u, v, randInt(rng, spec.weight.min, spec.weight.max)]);
    }
  }
  return [n, edges];
}

/** Generate one full argument list for a list of parameter specs. */
export function genArgs(specs: TypeSpec[], rng: Rng): unknown[] {
  const args: unknown[] = [];
  for (const s of specs) {
    if (s.kind === "graph") args.push(...genGraph(s, rng));
    else args.push(genValue(s, rng));
  }
  return args;
}

export function compareJson(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const inRange = (v: number, r: Range) => v >= r.min && v <= r.max;

/** Does a value conform to a spec? Used to drop illegal generated inputs and illegal shrink steps. */
export function conforms(v: unknown, spec: Exclude<TypeSpec, GraphSpec>): boolean {
  switch (spec.kind) {
    case "int":
      return isInt(v) && v >= spec.min && v <= spec.max;
    case "const":
      return JSON.stringify(v) === JSON.stringify(spec.value);
    case "oneOf":
      return spec.options.some((o) => o.kind !== "graph" && conforms(v, o));
    case "string":
      return (
        typeof v === "string" &&
        inRange(v.length, spec.len) &&
        [...v].every((c) => spec.alphabet.includes(c))
      );
    case "tuple": {
      if (!Array.isArray(v) || v.length !== spec.items.length) return false;
      if (!spec.items.every((it, i) => it.kind !== "graph" && conforms(v[i], it))) return false;
      if (spec.nondecreasing) for (let i = 1; i < v.length; i++) if (v[i - 1] > v[i]) return false;
      return true;
    }
    case "array": {
      if (!Array.isArray(v) || !inRange(v.length, spec.len)) return false;
      const of = spec.of;
      if (of.kind === "graph" || !v.every((x) => conforms(x, of))) return false;
      if (spec.distinct && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) return false;
      if (spec.sorted) {
        for (let i = 1; i < v.length; i++) {
          const c = compareJson(v[i - 1], v[i]);
          if (spec.sorted === "asc" ? c > 0 : c < 0) return false;
        }
      }
      return true;
    }
  }
}

function graphConforms(n: unknown, edges: unknown, spec: GraphSpec): boolean {
  if (!isInt(n) || !inRange(n, spec.n)) return false;
  if (!Array.isArray(edges) || !inRange(edges.length, spec.m)) return false;
  return edges.every(
    (e) =>
      Array.isArray(e) &&
      e.length === 3 &&
      e.every(isInt) &&
      e[0] >= 0 &&
      e[0] < n &&
      e[1] >= 0 &&
      e[1] < n &&
      inRange(e[2], spec.weight) &&
      (!spec.dag || e[0] < e[1]),
  );
}

/** Check a full argument list against parameter specs. */
export function argsConform(args: unknown[], specs: TypeSpec[]): boolean {
  let i = 0;
  for (const s of specs) {
    if (s.kind === "graph") {
      if (!graphConforms(args[i], args[i + 1], s)) return false;
      i += 2;
    } else {
      if (!conforms(args[i], s)) return false;
      i += 1;
    }
  }
  return i === args.length;
}

const KINDS = new Set(["int", "array", "string", "tuple", "const", "oneOf", "graph"]);

/** Parse untrusted (model-written) JSON into a TypeSpec, or throw with a reason. */
export function parseTypeSpec(raw: unknown, path = "spec"): TypeSpec {
  if (!raw || typeof raw !== "object") throw new Error(`${path}: expected an object`);
  const o = raw as Record<string, unknown>;
  if (typeof o.kind !== "string" || !KINDS.has(o.kind)) throw new Error(`${path}: unknown kind ${String(o.kind)}`);
  const range = (r: unknown, p: string): Range => {
    const rr = r as Range | undefined;
    if (!rr || !isInt(rr.min) || !isInt(rr.max) || rr.min > rr.max) throw new Error(`${p}: bad range`);
    return { min: rr.min, max: rr.max };
  };
  switch (o.kind) {
    case "int": {
      const r = range(o, path);
      const bias = o.bias === "edges" || o.bias === "small" ? o.bias : "uniform";
      return { kind: "int", ...r, bias };
    }
    case "const":
      return { kind: "const", value: o.value };
    case "oneOf":
      if (!Array.isArray(o.options) || o.options.length === 0) throw new Error(`${path}: oneOf needs options`);
      return { kind: "oneOf", options: o.options.map((x, i) => parseTypeSpec(x, `${path}.options[${i}]`)) };
    case "string": {
      if (typeof o.alphabet !== "string" || o.alphabet.length === 0) throw new Error(`${path}: alphabet`);
      return { kind: "string", alphabet: o.alphabet, len: range(o.len, `${path}.len`) };
    }
    case "tuple":
      if (!Array.isArray(o.items)) throw new Error(`${path}: tuple needs items`);
      return {
        kind: "tuple",
        items: o.items.map((x, i) => parseTypeSpec(x, `${path}.items[${i}]`)),
        nondecreasing: o.nondecreasing === true,
      };
    case "array":
      return {
        kind: "array",
        of: parseTypeSpec(o.of, `${path}.of`),
        len: range(o.len, `${path}.len`),
        sorted: o.sorted === "asc" || o.sorted === "desc" ? o.sorted : undefined,
        distinct: o.distinct === true,
        pool: isInt(o.pool) && o.pool > 0 ? o.pool : undefined,
      };
    case "graph":
      return {
        kind: "graph",
        n: range(o.n, `${path}.n`),
        m: range(o.m, `${path}.m`),
        weight: range(o.weight, `${path}.weight`),
        dag: o.dag === true,
      };
  }
  throw new Error(`${path}: unreachable`);
}
