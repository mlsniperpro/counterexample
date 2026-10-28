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

const alphabets = new WeakMap<StringSpec, string[]>();

/** The characters of a string spec's alphabet, split once per spec: splitting per generated string made 10,000 empty strings over 256 characters cost seconds. */
function alphabetOf(spec: StringSpec): string[] {
  let chars = alphabets.get(spec);
  if (!chars) {
    chars = [...spec.alphabet];
    alphabets.set(spec, chars);
  }
  return chars;
}

/**
 * Values one genArgs call may draw, discarded draws included: a `distinct` array retries duplicate draws, and nested
 * infeasible ones multiplied those retries (18 s for distinct arrays of distinct arrays of a const). Once spent, a
 * `distinct` array stops drawing; an input left too short is dropped by the validator, as any infeasible one is.
 */
const DRAW_BUDGET = 4 * 200_000;
let drawsLeft = Infinity;
const spend = (n: number) => {
  drawsLeft -= n;
};
const constSizes = new WeakMap<object, number>();
function constValues(spec: { value: unknown }): number {
  let n = constSizes.get(spec);
  if (n === undefined) constSizes.set(spec, (n = jsonValues(spec.value)));
  return n;
}

export function genValue(spec: Exclude<TypeSpec, GraphSpec>, rng: Rng): unknown {
  spend(1);
  switch (spec.kind) {
    case "int":
      return genInt(spec, rng);
    case "const":
      spend(constValues(spec));
      return structuredClone(spec.value);
    case "oneOf": {
      const opt = pick(rng, spec.options);
      if (opt.kind === "graph") throw new Error("graph is not allowed inside oneOf");
      return genValue(opt, rng);
    }
    case "string": {
      const n = randInt(rng, spec.len.min, spec.len.max);
      let s = "";
      const chars = alphabetOf(spec);
      for (let i = 0; i < n; i++) s += pick(rng, chars);
      return s;
    }
    case "tuple": {
      const out = spec.items.map((it) => {
        if (it.kind === "graph") throw new Error("graph is not allowed inside tuple");
        return genValue(it, rng);
      });
      // The order conforms checks: numbers by value, strings and lists as Python compares them.
      if (spec.nondecreasing) out.sort(compareJson);
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

/** Size and nesting caps on a const's value. */
const MAX_CONST_CHARS = 1000;
const MAX_CONST_DEPTH = 8;

/** Nesting depth of a JSON value (a scalar is 0), stopping once past the cap. */
function jsonDepth(v: unknown, d = 0): number {
  if (d > MAX_CONST_DEPTH || v === null || typeof v !== "object") return d;
  let deepest = d + 1;
  for (const x of Array.isArray(v) ? v : Object.values(v)) deepest = Math.max(deepest, jsonDepth(x, d + 1));
  return deepest;
}

/** Largest integer range a `distinct` array is drawn from without replacement (the range is built in full). */
const DISTINCT_SHUFFLE_MAX = 100_000;

/** Consecutive duplicate draws after which a `distinct` array stops growing (its element domain is used up). */
const MAX_DISTINCT_MISSES = 100;

/** How many values an array's pool really holds: a pool larger than the longest array can never be drawn from in full, so it is capped there. */
const poolSize = (spec: ArraySpec): number => (spec.pool && spec.pool > 0 ? Math.min(spec.pool, spec.len.max) : 0);

function genArray(spec: ArraySpec, rng: Rng): unknown[] {
  if (spec.of.kind === "graph") throw new Error("graph is not allowed inside array");
  const of = spec.of;
  // Copies of one const are all equal: a distinct array of them holds at most one.
  const n = spec.distinct && of.kind === "const" ? Math.min(1, randInt(rng, spec.len.min, spec.len.max)) : randInt(rng, spec.len.min, spec.len.max);
  const size = poolSize(spec);
  const pool = size > 0 ? Array.from({ length: size }, () => genValue(of, rng)) : undefined;
  // Distinct integers that fill at least half their range (a permutation of 0..n-1): draw without replacement. Drawing
  // with retries gives up on the last few free values, so most such arrays came out too short and were dropped.
  if (spec.distinct && !pool && of.kind === "int" && of.max - of.min + 1 <= DISTINCT_SHUFFLE_MAX && 2 * n >= of.max - of.min + 1) {
    const domain = Array.from({ length: of.max - of.min + 1 }, (_, i) => of.min + i);
    const take = Math.min(n, domain.length);
    for (let i = 0; i < take; i++) {
      const j = randInt(rng, i, domain.length - 1);
      [domain[i], domain[j]] = [domain[j] as number, domain[i] as number];
    }
    const out = domain.slice(0, take);
    if (spec.sorted) {
      sortJson(out);
      if (spec.sorted === "desc") out.reverse();
    }
    return out;
  }
  const out: unknown[] = [];
  const seen = new Set<string>();
  let attempts = 0;
  // A run of duplicates means the element domain is (nearly) used up: stop early instead of sampling n * 20 times
  // (a `distinct` array longer than its domain, say 10,000 elements of a 10-value constant, cost ~45 s of event loop).
  let misses = 0;
  // A short distinct array over a tiny domain gives up sooner: its misses were not counted by any value budget.
  const missLimit = Math.min(MAX_DISTINCT_MISSES, 2 * n + 8);
  while (out.length < n && attempts < n * 20 + 50 && misses < missLimit && (!spec.distinct || drawsLeft > 0)) {
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
    sortJson(out);
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
  const outer = drawsLeft;
  drawsLeft = Math.min(outer, DRAW_BUDGET);
  try {
    for (const s of specs) {
      if (s.kind === "graph") args.push(...genGraph(s, rng));
      else args.push(genValue(s, rng));
    }
  } finally {
    drawsLeft = outer;
  }
  return args;
}

/**
 * Sort in compareJson's order, in place. A list of numbers sorts numerically; anything else by compareJson, which
 * reads values in place (no serialising per comparison: 10,000 nested arrays took over a second that way).
 */
export function sortJson(xs: unknown[]): void {
  if (xs.every((x) => typeof x === "number")) (xs as number[]).sort((a, b) => a - b);
  else xs.sort(compareJson);
}

/** Strings by code point, as Python orders them (JavaScript's < compares UTF-16 units, which puts an emoji before U+FFFF). */
function compareCodePoints(a: string, b: string): number {
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    const x = a.codePointAt(i) as number;
    const y = b.codePointAt(j) as number;
    if (x !== y) return x - y;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  // Equal up to the shorter one: the shorter sorts first (after an equal prefix, the UTF-16 lengths order them the same way).
  return a.length - b.length;
}

/** Rank of a JSON type when two values of different types are compared: numbers, then strings, then lists, then the rest. */
const typeRank = (v: unknown): number => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : Array.isArray(v) ? 2 : 3);

/**
 * The natural order a statement means by "sorted", as Python compares values: numbers by value, strings by
 * character, lists element by element (a shorter prefix first). Values of other types or mixed types fall back to a
 * fixed order (by type, then by JSON text), so the order is still total.
 */
export function compareJson(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return compareCodePoints(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < a.length && i < b.length; i++) {
      const c = compareJson(a[i], b[i]);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  const r = typeRank(a) - typeRank(b);
  if (r !== 0) return r;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const inRange = (v: number, r: Range) => v >= r.min && v <= r.max;

/** Each string spec's alphabet as a set: `includes` on a string of astral characters took about 3 µs per character. */
const alphabetSets = new WeakMap<StringSpec, Set<string>>();
function alphabetSet(spec: StringSpec): Set<string> {
  let set = alphabetSets.get(spec);
  if (!set) alphabetSets.set(spec, (set = new Set(spec.alphabet)));
  return set;
}

/** Two JSON values equal (object keys in any order), compared in place: serialising both sides cost about 0.4 µs per float. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const o = b as Record<string, unknown>;
  return ka.length === Object.keys(o).length && ka.every((k) => Object.hasOwn(o, k) && jsonEqual((a as Record<string, unknown>)[k], o[k]));
}

/** Distinct values in a list: numbers and strings as they are, anything else by its JSON text. */
function distinctCount(xs: unknown[]): number {
  if (xs.every((x) => typeof x === "number" || typeof x === "string")) return new Set<unknown>(xs).size;
  return new Set(xs.map((x) => JSON.stringify(x))).size;
}

/** Does a value conform to a spec? Used to drop illegal generated inputs and illegal shrink steps. */
export function conforms(v: unknown, spec: Exclude<TypeSpec, GraphSpec>): boolean {
  switch (spec.kind) {
    case "int":
      return isInt(v) && v >= spec.min && v <= spec.max;
    case "const":
      return jsonEqual(v, spec.value);
    case "oneOf":
      return spec.options.some((o) => o.kind !== "graph" && conforms(v, o));
    case "string": {
      if (typeof v !== "string") return false;
      // Length in code points, as generation and Python count it (an emoji is one character, two UTF-16 units).
      const chars = [...v];
      const alphabet = alphabetSet(spec);
      return inRange(chars.length, spec.len) && chars.every((c) => alphabet.has(c));
    }
    case "tuple": {
      if (!Array.isArray(v) || v.length !== spec.items.length) return false;
      if (!spec.items.every((it, i) => it.kind !== "graph" && conforms(v[i], it))) return false;
      if (spec.nondecreasing) for (let i = 1; i < v.length; i++) if (compareJson(v[i - 1], v[i]) > 0) return false;
      return true;
    }
    case "array": {
      if (!Array.isArray(v) || !inRange(v.length, spec.len)) return false;
      const of = spec.of;
      if (of.kind === "graph" || !v.every((x) => conforms(x, of))) return false;
      // Elements of a const are all equal: distinct means at most one, with no need to serialise them.
      if (spec.distinct && (of.kind === "const" ? v.length > 1 : distinctCount(v) !== v.length)) return false;
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
    // A const is a small fixed value (a sentinel, a fixed word): its copies are cloned, compared and serialised per
    // element, so a deep or long one cost seconds while counting as a few values.
    z.object({ kind: z.literal("const"), value: z.json() }).refine((c) => JSON.stringify(c.value).length <= MAX_CONST_CHARS && jsonDepth(c.value) <= MAX_CONST_DEPTH, {
      message: `a const must be at most ${MAX_CONST_CHARS} characters of JSON, nested at most ${MAX_CONST_DEPTH} deep`,
    }),
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

/** Values in a JSON value, counted like generated ones: a string as its length (at least one), a list or object as one plus its contents, an object's keys by their length. */
export function jsonValues(value: unknown): number {
  let total = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === "string") total += Math.max(1, v.length);
    else if (Array.isArray(v)) {
      // Every list counts too: it is copied and walked like a value, so [[[[[0]]]]] is six, not one.
      total += 1;
      for (const x of v) stack.push(x);
    } else if (v !== null && typeof v === "object") {
      // Keys count like strings: a 20,000-character key repeated per element is 20,000 values each time, not one.
      const entries = Object.entries(v);
      total += 1;
      for (const [k, x] of entries) {
        total += k.length;
        stack.push(x);
      }
    } else total += 1;
  }
  return total;
}

/** Upper bound on the number of scalar values one generated input can contain. */
export function maxValues(spec: TypeSpec): number {
  switch (spec.kind) {
    case "int":
      return 1;
    case "const":
      return jsonValues(spec.value);
    case "string":
      // At least one: an empty string still costs a value's worth of generation, serialisation and comparison.
      return Math.max(1, spec.len.max);
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
 * Upper bound on the work `conforms` does for one value: a oneOf tries every option, so nested oneOfs multiply the
 * work per value even though the value count stays small (an array of 10,000 values, each tried against 16 x 16
 * options, is 2.6 million checks).
 */
export function checkCost(spec: TypeSpec): number {
  switch (spec.kind) {
    case "int":
    case "const":
    case "string":
    case "graph":
      return maxValues(spec);
    case "array":
      return Math.max(1, spec.len.max * checkCost(spec.of));
    case "tuple":
      return Math.max(1, spec.items.reduce((a, x) => a + checkCost(x), 0));
    case "oneOf":
      return spec.options.reduce((a, x) => a + checkCost(x), 0);
  }
}

/**
 * How many alternatives `conforms` may try for one value: the leaf options of the oneOfs it passes through, multiplied
 * when they nest. Capped at SPEC_LIMITS.maxOptions, so checking a value costs at most that many times its size and
 * every budget counted in values (a family's, small-scope's, shrinking's) also bounds the checking.
 */
export function fanOut(spec: TypeSpec): number {
  switch (spec.kind) {
    case "array":
      return fanOut(spec.of);
    case "tuple":
      return Math.max(1, ...spec.items.map(fanOut));
    case "oneOf":
      return spec.options.reduce((a, x) => a + fanOut(x), 0);
    default:
      return 1;
  }
}

/** The cost one input of these argument specs counts against the per-input and per-family limits: its values, or the checks it takes, whichever is more. */
function inputCost(args: TypeSpec[]): number {
  return Math.max(
    args.reduce((a, s) => a + maxValues(s), 0),
    args.reduce((a, s) => a + checkCost(s), 0),
  );
}

/**
 * Refuse argument specs whose inputs could hold, or take to check, more than SPEC_LIMITS.maxValuesPerInput values in all: the limit is
 * per input (all its arguments together), not per argument, or six large arguments would make inputs six times over it.
 */
export function checkInputValues(args: TypeSpec[], path: string): void {
  const total = args.reduce((a, s) => a + maxValues(s), 0);
  if (total > SPEC_LIMITS.maxValuesPerInput) throw new ModelOutputError(`${path}: one input could hold ${total} values across its arguments (limit ${SPEC_LIMITS.maxValuesPerInput})`);
  const checks = args.reduce((a, s) => a + checkCost(s), 0);
  if (checks > SPEC_LIMITS.maxValuesPerInput) throw new ModelOutputError(`${path}: checking one input could take ${checks} steps, because of oneOf options (limit ${SPEC_LIMITS.maxValuesPerInput})`);
}

/**
 * How many inputs of these argument specs fit in one family's value budget
 * (at least one), so a family of maximal inputs cannot exhaust memory or time.
 */
export function inputsWithinBudget(args: TypeSpec[], wanted: number): number {
  return Math.min(wanted, Math.max(1, Math.floor(SPEC_LIMITS.maxValuesPerFamily / Math.max(1, inputCost(args)))));
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
  const alternatives = fanOut(r.data);
  if (alternatives > SPEC_LIMITS.maxOptions) throw new ModelOutputError(`${path}: nested oneOf gives a value ${alternatives} alternatives to try (limit ${SPEC_LIMITS.maxOptions}); list them in one oneOf`);
  return r.data;
}
