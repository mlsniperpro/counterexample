import { z } from "zod";
import { checkInputValues, parseTypeSpec } from "../core/spec";
import { ModelOutputError } from "../errors";
import type { Problem, Solution } from "../problems/types";
import { exactReviver } from "../core/compare";
import { extractJson, parseJsonAnswer, stripThinking } from "./parse";

const MAX_PARAMS = 6;
const MAX_EXAMPLES = 10;

const IDENT = /^[A-Za-z_$][\w$]*$/;

// Cosmetic fields are normalised (trimmed, shortened); anything that changes behaviour must be valid as given.
const specAnswerSchema = z.object({
  title: z.string().min(1).transform((t) => t.slice(0, 80)),
  entry: z.string().regex(IDENT, "entry must be an identifier").nullish(),
  params: z.array(z.object({ name: z.string().min(1).max(40), type: z.unknown() })).min(1).max(MAX_PARAMS),
  returns: z.string().nullish().transform((r) => (r ?? "").slice(0, 200)),
  examples: z.array(z.object({ args: z.array(z.json()), output: z.json() })).max(MAX_EXAMPLES).default([]),
  compare: z.enum(["exact", "unordered", "unordered_nested", "float"]).default("exact"),
  references: z.array(z.string().max(200)).nullish().transform((r) => r?.slice(0, 2)),
});

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A JavaScript function expression or arrow function as a binding's value. */
const JS_FUNCTION_VALUE = String.raw`(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)`;

/** The first top-level function the code defines (also an `export`ed, `export default` or `async` one), used when the entry is missing from the code. */
export function firstFunctionName(code: string, language: Solution["language"]): string | undefined {
  const re =
    language === "python"
      ? /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/m
      : new RegExp(
          String.raw`^(?:export\s+(?:default\s+)?)?(?:async\s+)?function(?:\s*\*\s*|\s+)([A-Za-z_$][\w$]*)|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${JS_FUNCTION_VALUE}`,
          "m",
        );
  const m = re.exec(code);
  return m?.[1] ?? m?.[2];
}

/** True when the code defines `name` as a function: `def name(`, `function name(`, `name = (`, `name = function`, also after `export` or `async`. */
function definesFunction(code: string, language: Solution["language"], name: string): boolean {
  const n = escapeRe(name);
  const re =
    language === "python"
      ? new RegExp(String.raw`^(?:async\s+)?def\s+${n}\s*\(|^${n}\s*=(?!=)`, "m")
      : new RegExp(String.raw`(?<![\w$.])function(?:\s*\*\s*|\s+)${n}\s*\(|(?<![\w$.])${n}\s*=\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)`);
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
 * misleading load error) the first top-level function, preferring `solve`.
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
  const entry = definesFunction(code, language, "solve") ? "solve" : firstFunctionName(code, language);
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
  const params = a.params.map((p, i) => ({ name: p.name, type: parseTypeSpec(p.type, `params[${i}].type`) }));
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
  const notes = [note, floats ? 'The examples return non-integer numbers, so outputs are compared as floats (the model asked for "exact")' : undefined].filter(Boolean).join("; ");
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
