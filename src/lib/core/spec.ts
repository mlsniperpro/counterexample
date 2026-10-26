import { z } from "zod";
import { ModelOutputError } from "../errors";
import { pick, randInt, type Rng } from "./rng";

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
  /**
   * "path": the first edges form the chain 0 -> 1 -> ... -> n-1 (as far as the
   * edge count allows), the rest are random. Random edges almost never form a
   * long chain, so deep graphs need this. Default "random".
   */
  shape?: "random" | "path";
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
      const opt = pick(rng, spec.options);
      if (opt.kind === "graph") throw new Error("graph is not allowed inside oneOf");
      return genValue(opt, rng);
    }
    case "string": {
      const n = randInt(rng, spec.len.min, spec.len.max);
      let s = "";
      const chars = [...spec.alphabet];
      for (let i = 0; i < n; i++) s += pick(rng, chars);
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
    return pick(rng, picks);
  }
  if (spec.bias === "small" && rng() < 0.7) {
    const lo = Math.max(min, -10);
    const hi = Math.min(max, 10);
    if (lo <= hi) return randInt(rng, lo, hi);
  }
  return randInt(rng, min, max);
}

/** Consecutive duplicate draws after which a `distinct` array stops growing (its element domain is used up). */
const MAX_DISTINCT_MISSES = 100;

/** How many values an array's pool really holds: a pool larger than the longest array can never be drawn from in full, so it is capped there. */
const poolSize = (spec: ArraySpec): number => (spec.pool && spec.pool > 0 ? Math.min(spec.pool, spec.len.max) : 0);

function genArray(spec: ArraySpec, rng: Rng): unknown[] {
  if (spec.of.kind === "graph") throw new Error("graph is not allowed inside array");
  const of = spec.of;
  const n = randInt(rng, spec.len.min, spec.len.max);
  const size = poolSize(spec);
  const pool = size > 0 ? Array.from({ length: size }, () => genValue(of, rng)) : undefined;
  const out: unknown[] = [];
  const seen = new Set<string>();
  let attempts = 0;
  // A run of duplicates means the element domain is (nearly) used up: stop early instead of sampling n * 20 times
  // (a `distinct` array longer than its domain, say 10,000 elements of a 10-value constant, cost ~45 s of event loop).
  let misses = 0;
  while (out.length < n && attempts < n * 20 + 50 && misses < MAX_DISTINCT_MISSES) {
    attempts++;
    const v = pool ? pick(rng, pool) : genValue(of, rng);
    if (spec.distinct) {
      const key = JSON.stringify(v);
      if (seen.has(key)) {
        misses++;
        continue;
      }
      seen.add(key);
      misses = 0;
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
  // A DAG needs two distinct nodes per edge; with n = 1 it can have no edges (conforms then rejects m.min > 0).
  if (n < 1 || (spec.dag && n < 2)) return [n, edges];
  if (spec.shape === "path") for (let u = 0; u + 1 < n && edges.length < m; u++) edges.push([u, u + 1, randInt(rng, spec.weight.min, spec.weight.max)]);
  while (edges.length < m) {
    let u = randInt(rng, 0, n - 1);
    let v = randInt(rng, 0, n - 1);
    if (spec.dag) {
      if (u === v) v = (u + 1 + randInt(rng, 0, n - 2)) % n;
      if (u > v) [u, v] = [v, u];
    }
    edges.push([u, v, randInt(rng, spec.weight.min, spec.weight.max)]);
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
  return edges.every((e: unknown) => {
    if (!Array.isArray(e) || e.length !== 3 || !e.every(isInt)) return false;
    const [u, v, w] = e as [number, number, number];
    return u >= 0 && u < n && v >= 0 && v < n && inRange(w, spec.weight) && (!spec.dag || u < v);
  });
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

/** Hard caps on what a (model-written) spec may ask for, so generation stays bounded in memory and time. */
export const SPEC_LIMITS = { maxLen: 10_000, maxNodes: 1_000, maxEdges: 10_000, maxOptions: 16, maxDepth: 4, maxValuesPerInput: 200_000, maxValuesPerFamily: 500_000 } as const;

/** Optional field where JSON null means "not set" (models often write null). */
const opt = <T extends z.ZodType>(t: T) => t.nullish().transform((v) => v ?? undefined);
const safeInt = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const range = (cap: number) =>
  z
    .object({ min: z.number().int().min(0), max: z.number().int().max(cap) })
    .refine((r) => r.min <= r.max, { message: "bad range: min > max" });
const intRange = z
  .object({ min: safeInt, max: safeInt })
  .refine((r) => r.min <= r.max, { message: "bad range: min > max" });

const typeSpecSchema: z.ZodType<TypeSpec> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .object({ kind: z.literal("int"), min: safeInt, max: safeInt, bias: opt(z.enum(["uniform", "edges", "small"])) })
      .refine((r) => r.min <= r.max, { message: "bad range: min > max" }),
    z.object({
      kind: z.literal("array"),
      of: typeSpecSchema,
      len: range(SPEC_LIMITS.maxLen),
      sorted: opt(z.enum(["asc", "desc"])),
      distinct: opt(z.boolean()),
      pool: opt(z.number().int().min(1).max(SPEC_LIMITS.maxLen)),
    }),
    z.object({ kind: z.literal("string"), alphabet: z.string().min(1).max(256), len: range(SPEC_LIMITS.maxLen) }),
    z.object({ kind: z.literal("tuple"), items: z.array(typeSpecSchema).min(1).max(SPEC_LIMITS.maxOptions), nondecreasing: opt(z.boolean()) }),
    z.object({ kind: z.literal("const"), value: z.json() }),
    z.object({ kind: z.literal("oneOf"), options: z.array(typeSpecSchema).min(1).max(SPEC_LIMITS.maxOptions) }),
    z.object({
      kind: z.literal("graph"),
      n: range(SPEC_LIMITS.maxNodes),
      m: range(SPEC_LIMITS.maxEdges),
      weight: intRange,
      dag: opt(z.boolean()),
      shape: opt(z.enum(["random", "path"])),
    }),
  ]),
);

function depth(spec: TypeSpec): number {
  switch (spec.kind) {
    case "array":
      return 1 + depth(spec.of);
    case "tuple":
      return 1 + Math.max(...spec.items.map(depth));
    case "oneOf":
      return 1 + Math.max(...spec.options.map(depth));
    default:
      return 1;
  }
}

/** Upper bound on the number of scalar values one generated input can contain. */
export function maxValues(spec: TypeSpec): number {
  switch (spec.kind) {
    case "int":
    case "const":
      return 1;
    case "string":
      return spec.len.max;
    case "array":
      // The elements, plus the pool they are drawn from (it is generated first).
      return (spec.len.max + poolSize(spec)) * maxValues(spec.of);
    case "tuple":
      return spec.items.reduce((a, x) => a + maxValues(x), 0);
    case "oneOf":
      return Math.max(...spec.options.map(maxValues));
    case "graph":
      return 1 + 3 * spec.m.max;
  }
}

/**
 * How many inputs of these argument specs fit in one family's value budget
 * (at least one), so a family of maximal inputs cannot exhaust memory or time.
 */
export function inputsWithinBudget(args: TypeSpec[], wanted: number): number {
  const per = args.reduce((a, s) => a + maxValues(s), 0);
  return Math.min(wanted, Math.max(1, Math.floor(SPEC_LIMITS.maxValuesPerFamily / Math.max(1, per))));
}

/** Nested graphs make no sense (a graph expands to two top-level arguments). */
function hasNestedGraph(spec: TypeSpec, top: boolean): boolean {
  switch (spec.kind) {
    case "graph":
      return !top;
    case "array":
      return hasNestedGraph(spec.of, false);
    case "tuple":
      return spec.items.some((x) => hasNestedGraph(x, false));
    case "oneOf":
      return spec.options.some((x) => hasNestedGraph(x, false));
    default:
      return false;
  }
}

/** Parse untrusted (model-written) JSON into a TypeSpec, or throw ModelOutputError with the reason. */
export function parseTypeSpec(raw: unknown, path = "spec"): TypeSpec {
  const r = typeSpecSchema.safeParse(raw);
  if (!r.success) throw new ModelOutputError(`${path}: ${z.prettifyError(r.error)}`);
  if (depth(r.data) > SPEC_LIMITS.maxDepth) throw new ModelOutputError(`${path}: nested deeper than ${SPEC_LIMITS.maxDepth}`);
  if (maxValues(r.data) > SPEC_LIMITS.maxValuesPerInput) {
    throw new ModelOutputError(`${path}: one input could hold ${maxValues(r.data)} values (limit ${SPEC_LIMITS.maxValuesPerInput})`);
  }
  if (hasNestedGraph(r.data, true)) throw new ModelOutputError(`${path}: graph is only allowed as a top-level argument`);
  return r.data;
}
