import { z } from "zod";
import { checkInputValues, parseTypeSpec } from "../core/spec";
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
  // "solve(nums, target)" means solve.
  entry: z
    .string()
    .transform((e) => /^\s*([A-Za-z_$][\w$]*)\s*(?:\([^()]*\)\s*)?$/.exec(e)?.[1] ?? e)
    .pipe(z.string().regex(IDENT, "entry must be an identifier"))
    .nullish(),
  params: z.array(z.object({ name: z.string().min(1).transform((n) => n.slice(0, 40)), type: z.unknown() })).min(1).max(MAX_PARAMS),
  returns: z.string().nullish().transform((r) => (r ?? "").slice(0, 200)),
  // The first MAX_EXAMPLES are enough to check the oracle.
  examples: z.array(z.object({ args: z.array(z.json()), output: z.json() })).default([]).transform((xs) => xs.slice(0, MAX_EXAMPLES)),
  compare: z.enum(["exact", "unordered", "unordered_nested", "float"]).default("exact"),
  references: z.array(z.string()).nullish().transform((r) => r?.slice(0, 2).map((x) => x.slice(0, 200))),
});

/**
 * Integer bounds past 2^53 - 1 (a statement's 1 <= n <= 10^18) clamped to the largest exact integer, since inputs
 * are bounded to safe integers anyway; reports whether anything was clamped.
 */
function clampIntBounds(type: unknown): { type: unknown; clamped: boolean } {
  let clamped = false;
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 16 || v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, depth + 1)]));
    for (const k of ["min", "max"]) {
      const x = o[k];
      if (typeof x === "number" && Number.isFinite(x) && Math.abs(x) > Number.MAX_SAFE_INTEGER && "min" in o && "max" in o) {
        o[k] = Math.sign(x) * Number.MAX_SAFE_INTEGER;
        clamped = true;
      }
    }
    return o;
  };
  return { type: walk(type, 0), clamped };
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
function resolveEntry(code: string, language: Solution["language"], named: string | null | undefined): { entry: string; note?: string } {
  if (named && definesFunction(code, language, named)) return { entry: named };
  // A method (LeetCode's class Solution) is not callable as a function: falling back to another top-level function,
  // often a helper defined above the class, would attack the wrong code and blame it for a bug.
  // A top-level solve (often a wrapper that calls the method) is still attacked: the refusal is only for code with no
  // function the harness can call in its place.
  const hasSolve = definesFunction(code, language, "solve");
  const method = hasSolve ? undefined : named && definesMethod(code, language, named) ? named : /^\s*(?:export\s+)?class\s+Solution\b/m.test(code) ? "Solution" : undefined;
  if (method) {
    throw new ModelOutputError(
      `the solution is ${method === "Solution" ? "a class Solution" : `"${method}", a method inside a class`}: methods are not supported yet, so write it as a top-level function${language === "python" ? " (without self)" : ""}`,
    );
  }
  // The named function under another spelling (integer_sqrt for integerSqrt), else solve, else the last top-level
  // function: helpers are defined before the function that uses them, so the first one is usually a helper.
  const fns = topLevelFunctions(code, language);
  const spelled = named ? fns.find((f) => looseName(f) === looseName(named)) : undefined;
  const entry = spelled ?? (hasSolve ? "solve" : fns.at(-1));
  if (!entry) {
    throw new ModelOutputError(named ? `problem spec: entry "${named}" is not defined in the code, and the code has no top-level function` : "problem spec: no entry function named, and none found in the code");
  }
  return named ? { entry, note: `The model named entry "${named}", which the code does not define; using "${entry}" instead` } : { entry };
}

/** True when a JSON value holds a number that is not an integer (an average, a probability). */
export function hasFraction(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v) && !Number.isInteger(v);
  if (Array.isArray(v)) return v.some(hasFraction);
  if (v !== null && typeof v === "object") return Object.values(v).some(hasFraction);
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
  const { entry, note } = resolveEntry(solution.code, solution.language, a.entry);
  const bounds = a.params.map((p) => clampIntBounds(p.type));
  const params = a.params.map((p, i) => ({ name: p.name, type: parseTypeSpec(bounds[i]?.type, `params[${i}].type`) }));
  checkInputValues(params.map((p) => p.type), "params");
  if (a.examples.length === 0) throw new ModelOutputError("problem spec: no examples, so the oracle could not be checked");
  // Expected outputs keep integers beyond 2^53 exact, like the harness's outputs they are compared with
  // (arguments stay plain numbers: inputs are bounded to safe integers anyway).
  const exact = extractJson(stripThinking(text), exactReviver) as { examples?: { output?: unknown }[] };
  const examples = a.examples.map((e, i) => ({ ...e, output: exact.examples?.[i]?.output ?? e.output }));
  // Exact comparison of floating-point answers flags a correct solution that sums in another order (1.6666666666666665
  // against 1.6666666666666667), so an exact spec whose example outputs hold fractions compares as floats.
  const floats = a.compare === "exact" && examples.some((e) => hasFraction(e.output));
  const compare = floats ? "float" : a.compare;
  const notes = [
    note,
    floats ? 'The examples return non-integer numbers, so outputs are compared as floats (the model asked for "exact")' : undefined,
    bounds.some((b) => b.clamped) ? "Integer bounds beyond 2^53 - 1 were lowered to 2^53 - 1, the largest integer every input can hold exactly" : undefined,
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
