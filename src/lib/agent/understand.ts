import { z } from "zod";
import { checkInputValues, maxValues, parseTypeSpec, SPEC_LIMITS, type TypeSpec } from "../core/spec";
import { ModelOutputError } from "../errors";
import type { Problem, Solution } from "../problems/types";
import { exactReviver } from "../core/compare";
import { extractJson, parseJsonAnswer, stripThinking } from "./parse";

const MAX_PARAMS = 6;
const MAX_EXAMPLES = 10;

const IDENT = /^[A-Za-z_$][\w$]*$/;

// Cosmetic fields are normalised (trimmed, shortened), and so is what has one obvious reading (an entry written as a
// call, extra examples); anything else that changes behaviour must be valid as given.
const specAnswerSchema = z.object({
  title: z.string().min(1).transform((t) => t.slice(0, 80)),
  // The name in whatever the model wrote ("solve(nums, target)", "def solve(x) -> int", "Solution.solve", "`solve`"),
  // or none: resolveEntry then finds the function in the code, rather than the whole attack failing on this text.
  entry: z
    .string()
    .nullish()
    .transform((e) => (e ? entryNames(e) : [])),
  params: z.array(z.object({ name: z.string().min(1).transform((n) => n.slice(0, 40)), type: z.unknown() })).min(1).max(MAX_PARAMS),
  returns: z.string().nullish().transform((r) => (r ?? "").slice(0, 200)),
  // The first MAX_EXAMPLES are enough to check the oracle.
  examples: z.array(z.object({ args: z.array(z.json()), output: z.json() })).default([]).transform((xs) => xs.slice(0, MAX_EXAMPLES)),
  compare: z.preprocess((c) => (typeof c === "string" ? c.toLowerCase().replace(/-/g, "_") : (c ?? undefined)), z.enum(["exact", "unordered", "unordered_nested", "float"]).default("exact")),
  references: z.array(z.string()).nullish().transform((r) => r?.slice(0, 2).map((x) => x.slice(0, 200))),
});

/**
 * Integer bounds past 2^53 - 1 (a statement's 1 <= n <= 10^18) clamped to the largest exact integer, since inputs
 * are bounded to safe integers anyway; reports whether anything was clamped.
 */
function clampIntBounds(type: unknown): { type: unknown; clamped: boolean; capped: boolean } {
  let clamped = false;
  let capped = false;
  // Sizes past the DSL's caps (a statement's n <= 10^5) come down to the cap: the attack then covers the inputs it can
  // generate, and says so, instead of failing on the number.
  const caps: Record<string, number> = { len: SPEC_LIMITS.maxLen, n: SPEC_LIMITS.maxNodes, m: SPEC_LIMITS.maxEdges };
  const walk = (v: unknown, depth: number, key: string): unknown => {
    if (depth > 16 || v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1, ""));
    // A flag written as off ("sorted": false, "pool": 0) means it is not set.
    // A const's value is data, not a spec: it is kept exactly as written.
    if ((v as { kind?: unknown }).kind === "const") return v;
    const o = Object.fromEntries(
      Object.entries(v)
        .filter(([k, x]) => !(["sorted", "distinct", "nondecreasing"].includes(k) && x === false) && !(k === "pool" && x === 0))
        .map(([k, x]) => [k, walk(x, depth + 1, k)]),
    );
    if (typeof o.pool === "number" && o.pool > SPEC_LIMITS.maxLen) {
      o.pool = SPEC_LIMITS.maxLen;
      capped = true;
    }
    for (const k of ["min", "max"]) {
      const x = o[k];
      if (typeof x === "number" && Number.isFinite(x) && Math.abs(x) > Number.MAX_SAFE_INTEGER && "min" in o && "max" in o) {
        o[k] = Math.sign(x) * Number.MAX_SAFE_INTEGER;
        clamped = true;
      }
      const cap = caps[key];
      if (cap !== undefined && typeof o[k] === "number" && (o[k] as number) > cap && "min" in o && "max" in o) {
        o[k] = cap;
        capped = true;
      }
    }
    return o;
  };
  return { type: walk(type, 0, ""), clamped, capped };
}

const KEYWORDS = new Set(["def", "function", "async", "export", "default", "const", "let", "var", "return", "self", "class", "lambda"]);

/**
 * The identifiers in an entry as a model may write it ("solve(nums, target)", "def solve(x) -> int",
 * "Solution().maxProfit", "var twoSum = function(nums, target)"): the one before the first "(" first, then the
 * others in order. resolveEntry takes the first the code defines.
 */
function entryNames(text: string): string[] {
  const t = text.slice(0, 200);
  const words = [...t.matchAll(/[A-Za-z_$][\w$]*/g)].filter((m) => !KEYWORDS.has(m[0]) && IDENT.test(m[0]));
  const called = words.find((m) => /^\s*\(/.test(t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 20)));
  const names = words.map((m) => m[0]);
  return called ? [called[0], ...names.filter((n) => n !== called[0])] : names;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A JavaScript function expression or arrow function as a binding's value. */
const JS_FUNCTION_VALUE = String.raw`(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)`;

/** The top-level functions the code defines (also `export`ed, `export default` or `async` ones), in order. */
export function topLevelFunctions(code: string, language: Solution["language"]): string[] {
  const re =
    language === "python"
      ? /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm
      : new RegExp(
          String.raw`^(?:export\s+(?:default\s+)?)?(?:async\s+)?function(?:\s*\*\s*|\s+)([A-Za-z_$][\w$]*)|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${JS_FUNCTION_VALUE}`,
          "gm",
        );
  return [...code.matchAll(re)].map((m) => (m[1] ?? m[2]) as string);
}

/** The first top-level function the code defines. */
export function firstFunctionName(code: string, language: Solution["language"]): string | undefined {
  return topLevelFunctions(code, language)[0];
}

/** A name with case and underscores dropped, so integerSqrt, integer_sqrt and IntegerSqrt compare equal. */
const looseName = (name: string) => name.replace(/[_$]/g, "").toLowerCase();

/** True when the code defines `name` as a function: `def name(`, `function name(`, `name = (`, `name = function`, also after `export` or `async`. */
function definesFunction(code: string, language: Solution["language"], name: string): boolean {
  const n = escapeRe(name);
  const re =
    language === "python"
      ? new RegExp(String.raw`^(?:async\s+)?def\s+${n}\s*\(|^${n}\s*=(?!=)`, "m")
      : new RegExp(String.raw`(?<![\w$.])function(?:\s*\*\s*|\s+)${n}\s*\(|(?<![\w$.])${n}\s*=\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)|^(?:export\s+)?(?:const|let|var)\s+${n}\s*=(?!=)`, "m");
  return re.test(code);
}

/** Whether the code defines `name` as an indented method in code that has a class, rather than at the top level. */
function definesMethod(code: string, language: Solution["language"], name: string): boolean {
  const n = escapeRe(name);
  const re = language === "python" ? new RegExp(String.raw`^[ \t]+(?:async\s+)?def\s+${n}\s*\(`, "m") : new RegExp(String.raw`^[ \t]+(?:static\s+)?(?:async\s+)?${n}\s*\([^)]*\)\s*\{`, "m");
  // Indented alone is also a nested function or an object's method: only a class makes it one the harness cannot call.
  return re.test(code) && /^[ \t]*(?:export\s+(?:default\s+)?)?class\s+[A-Za-z_$]/m.test(code);
}

/**
 * The function the harness will call. The model's `entry` is used when the
 * code defines it; otherwise (an invented name would fail every input with a
 * misleading load error) the same name spelled another way, else `solve`, else the
 * last top-level function.
 */
/** How many parameters a top-level function takes (self, `*` and `/` markers aside), or undefined when it cannot tell. */
function paramCount(code: string, language: Solution["language"], name: string): number | undefined {
  const n = escapeRe(name);
  const re =
    language === "python"
      ? new RegExp(String.raw`^(?:async[ \t]+)?def[ \t]+${n}[ \t]*\(([^)]*)\)`, "m")
      : new RegExp(String.raw`function(?:[ \t]*\*)?[ \t]*${n}[ \t]*\(([^)]*)\)|(?:const|let|var)[ \t]+${n}[ \t]*=[ \t]*(?:async[ \t]*)?(?:function[ \t]*\(([^)]*)\)|\(([^)]*)\)|([A-Za-z_$][\w$]*)[ \t]*=>)`, "m");
  const m = re.exec(code);
  if (!m) return undefined;
  const list = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
  // Commas inside brackets belong to a type annotation (Dict[int, int]) or a default value, not between parameters.
  let depth = 0;
  let count = 0;
  let current = "";
  const flush = () => {
    const p = current.trim();
    if (p && p !== "self" && p !== "*" && p !== "/") count++;
    current = "";
  };
  for (const c of list) {
    if ("[({<".includes(c)) depth++;
    else if ("])}>".includes(c)) depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) flush();
    else current += c;
  }
  flush();
  return count;
}

function resolveEntry(code: string, language: Solution["language"], names: string[], arity: number): { entry: string; note?: string } {
  // A name the code defines as a top-level function; any other definition (a module-level `x = ...`, a `const solve =
  // memoize(...)`) only for the one name meant (the first), or a parameter name assigned in a driver line would win.
  const tops = topLevelFunctions(code, language);
  const defined = names.find((n) => tops.includes(n)) ?? (names[0] && definesFunction(code, language, names[0]) ? names[0] : undefined);
  if (defined) return { entry: defined };
  const named = names.find((n) => definesMethod(code, language, n)) ?? names[0];
  // A method (LeetCode's class Solution) is not callable as a function: falling back to another top-level function,
  // often a helper defined above the class, would attack the wrong code and blame it for a bug.
  // A top-level solve (often a wrapper that calls the method) is still attacked: the refusal is only for code with no
  // function the harness can call in its place.
  const hasSolve = definesFunction(code, language, "solve");
  const method = hasSolve ? undefined : named && definesMethod(code, language, named) ? named : /^[ \t]*(?:export[ \t]+)?class[ \t]+Solution\b/m.test(code) ? "Solution" : undefined;
  if (method) {
    throw new ModelOutputError(
      `the solution is ${method === "Solution" ? "a class Solution" : `"${method}", a method inside a class`}: methods are not supported yet, so write it as a top-level function${language === "python" ? " (without self)" : ""}`,
    );
  }
  // The named function under another spelling (integer_sqrt for integerSqrt), else solve, else the last top-level
  // function that takes as many parameters as the problem passes (helpers usually come first, and a trailing main()
  // takes none), else the last one that is not main.
  const fns = topLevelFunctions(code, language);
  const spelled = fns.find((f) => names.some((n) => looseName(f) === looseName(n)));
  const candidates = fns.filter((f) => f !== "main");
  const fitting = candidates.filter((f) => paramCount(code, language, f) === arity);
  const entry = spelled ?? (hasSolve ? "solve" : (fitting.at(-1) ?? candidates.at(-1) ?? fns.at(-1)));
  if (!entry) {
    throw new ModelOutputError(named ? `problem spec: entry "${named}" is not defined in the code, and the code has no top-level function` : "problem spec: no entry function named, and none found in the code");
  }
  return named ? { entry, note: `The model named entry "${named}", which the code does not define; using "${entry}" instead` } : { entry };
}

/**
 * Parse the parameter types, shortening the outermost list of the largest one when an input could hold more than the
 * per-input value cap (10^4 words of up to 20 letters is 200,001 values once the list itself counts): the attack then
 * covers inputs it can generate, and says so, instead of failing on the bound.
 */
function fitValueCap(raw: unknown[]): { types: TypeSpec[]; lowered: boolean } {
  const types = raw.map((t) => structuredClone(t)) as Record<string, unknown>[];
  let lowered = false;
  for (let attempt = 0; ; attempt++) {
    let over: { at: number; values: number } | undefined;
    const parsed: TypeSpec[] = [];
    for (let i = 0; i < types.length && !over; i++) {
      try {
        parsed.push(parseTypeSpec(types[i], `params[${i}].type`));
      } catch (e) {
        const m = /could hold (\d+) values/.exec(e instanceof Error ? e.message : "");
        if (!m || attempt >= 8) throw e;
        over = { at: i, values: Number(m[1]) };
      }
    }
    if (!over) {
      const total = parsed.reduce((n, t) => n + maxValues(t), 0);
      if (total <= SPEC_LIMITS.maxValuesPerInput || attempt >= 8) return { types: parsed, lowered };
      const at = parsed.reduce((best, t, i) => (t.kind === "array" && maxValues(t) > maxValues(parsed[best] as TypeSpec) ? i : best), 0);
      over = { at, values: total };
    }
    const t = types[over.at] as { kind?: unknown; len?: { min: number; max: number } };
    if (t.kind !== "array" || !t.len) throw new ModelOutputError(`problem spec: params[${over.at}].type: one input could hold ${over.values} values (limit ${SPEC_LIMITS.maxValuesPerInput})`);
    const max = Math.max(0, Math.floor((t.len.max * SPEC_LIMITS.maxValuesPerInput) / over.values) - 1);
    t.len = { min: Math.min(t.len.min, max), max };
    lowered = true;
  }
}

/** True when a JSON value holds an integer past 2^53 (it was rounded when parsed). */
function hasUnsafeInteger(v: unknown): boolean {
  if (typeof v === "number") return Number.isInteger(v) && !Number.isSafeInteger(v);
  if (Array.isArray(v)) return v.some(hasUnsafeInteger);
  if (v !== null && typeof v === "object") return Object.values(v).some(hasUnsafeInteger);
  return false;
}

/** True when a JSON value holds a number that is not an integer (an average, a probability). */
export function hasFraction(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v) && !Number.isInteger(v);
  if (Array.isArray(v)) return v.some(hasFraction);
  if (v !== null && typeof v === "object") return Object.values(v).some(hasFraction);
  return false;
}

/** Stands for an integral number written with a decimal point (2.0) in a model's JSON. */
const FLOAT_LITERAL = Object.freeze({ floatLiteral: true });
/** JSON.parse reviver: an integral number written with a decimal point becomes FLOAT_LITERAL (an exponent alone, 1e18, does not: integers are written that way too). */
function floatLiteralReviver(_key: string, value: unknown, ctx?: { source?: string }): unknown {
  return typeof value === "number" && Number.isInteger(value) && ctx?.source && ctx.source.includes(".") ? FLOAT_LITERAL : value;
}
function holdsFloatLiteral(v: unknown): boolean {
  if (v === FLOAT_LITERAL) return true;
  if (Array.isArray(v)) return v.some(holdsFloatLiteral);
  if (v !== null && typeof v === "object") return Object.values(v).some(holdsFloatLiteral);
  return false;
}

/**
 * Live mode only: turn the fast model's answer about a pasted statement into
 * a typed Problem. The answer is schema-validated: cosmetic fields are
 * normalised, anything that affects the attack (types, examples, entry) must
 * be valid or it is a ModelOutputError.
 */
export function parseUnderstanding(text: string, statement: string, solution: Pick<Solution, "code" | "language">): { problem: Problem; entry: string; note?: string } {
  const a = parseJsonAnswer(stripThinking(text), specAnswerSchema, "problem spec");
  const arity = a.params.reduce((n, p) => n + (typeof p.type === "object" && p.type !== null && (p.type as { kind?: unknown }).kind === "graph" ? 2 : 1), 0);
  const { entry, note } = resolveEntry(solution.code, solution.language, a.entry, arity);
  const bounds = a.params.map((p) => clampIntBounds(p.type));
  const fitted = fitValueCap(bounds.map((b) => b.type));
  const params = a.params.map((p, i) => ({ name: p.name, type: fitted.types[i] as TypeSpec }));
  checkInputValues(params.map((p) => p.type), "params");
  if (a.examples.length === 0) throw new ModelOutputError("problem spec: no examples, so the oracle could not be checked");
  // Expected outputs keep integers beyond 2^53 exact, like the harness's outputs they are compared with
  // (arguments stay plain numbers: inputs are bounded to safe integers anyway).
  const exact = extractJson(stripThinking(text), exactReviver) as { examples?: { output?: unknown }[] };
  // An argument beyond 2^53 reaches the oracle rounded, so its example could never match: such examples are left out.
  const all = a.examples.map((e, i) => ({ ...e, output: exact.examples?.[i]?.output ?? e.output }));
  const examples = all.filter((e) => !hasUnsafeInteger(e.args));
  const dropped = all.length - examples.length;
  if (examples.length === 0) throw new ModelOutputError("problem spec: every example passes an integer beyond 2^53, which no program receives exactly, so the oracle could not be checked");
  // An exact spec compares as floats when an example output holds a fraction or is written with a decimal point (2.0,
  // 2500.00000): float answers then keep a tolerance. Exact mode itself already lets two non-integer numbers differ by
  // rounding (a mean summed in another order), so the float problem whose examples are all whole is covered there, and
  // nothing in the wording of a statement or a return type turns an integer problem's exact comparison off.
  let floatWritten = false;
  try {
    floatWritten = (extractJson(stripThinking(text), floatLiteralReviver) as { examples?: { output?: unknown }[] }).examples?.some((e) => holdsFloatLiteral(e?.output)) ?? false;
  } catch {
    // A reviver overflows the stack on JSON nested thousands deep, where the plain parse above worked: not written as floats.
  }
  const floatReason =
    a.compare !== "exact"
      ? undefined
      : examples.some((e) => hasFraction(e.output))
        ? "The examples return non-integer numbers"
        : floatWritten
          ? "The examples write their outputs with a decimal point"
          : undefined;
  const compare = floatReason ? "float" : a.compare;
  const notes = [
    note,
    floatReason ? `${floatReason}, so outputs are compared as floats (the model asked for "exact")` : undefined,
    bounds.some((b) => b.clamped) ? "Integer bounds beyond 2^53 - 1 were lowered to 2^53 - 1, the largest integer every input can hold exactly" : undefined,
    fitted.lowered ? `The longest list was shortened so that one input holds at most ${SPEC_LIMITS.maxValuesPerInput.toLocaleString("en-US")} values` : undefined,
    bounds.some((b) => b.capped) ? `Sizes beyond the generator's limits were lowered to them (lengths ${SPEC_LIMITS.maxLen.toLocaleString("en-US")}, graphs ${SPEC_LIMITS.maxNodes.toLocaleString("en-US")} nodes and ${SPEC_LIMITS.maxEdges.toLocaleString("en-US")} edges), so the largest inputs are not tried` : undefined,
    dropped ? `${dropped} example(s) whose arguments hold integers beyond 2^53 were left out of the oracle check (they cannot be passed exactly)` : undefined,
  ]
    .filter(Boolean)
    .join("; ");
  return {
    entry,
    ...(notes ? { note: notes } : {}),
    problem: {
      id: "custom",
      title: a.title,
      statement,
      params,
      returns: a.returns,
      examples,
      compare,
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      references: a.references,
    },
  };
}
