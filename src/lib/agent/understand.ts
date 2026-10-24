import { z } from "zod";
import { parseTypeSpec } from "../core/spec";
import { ModelOutputError } from "../errors";
import type { Problem, Solution } from "../problems/types";
import { parseJsonAnswer, stripThinking } from "./parse";

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
  compare: z.enum(["exact", "unordered", "float"]).default("exact"),
  references: z.array(z.string().max(200)).nullish().transform((r) => r?.slice(0, 2)),
});

/** The first top-level function the code defines, used when the model does not name the entry point. */
export function firstFunctionName(code: string, language: Solution["language"]): string | undefined {
  const re = language === "python" ? /^def\s+([A-Za-z_]\w*)\s*\(/m : /^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/m;
  const m = re.exec(code);
  return m?.[1] ?? m?.[2];
}

/**
 * Live mode only: turn the fast model's answer about a pasted statement into
 * a typed Problem. The answer is schema-validated: cosmetic fields are
 * normalised, anything that affects the attack (types, examples, entry) must
 * be valid or it is a ModelOutputError.
 */
export function parseUnderstanding(text: string, statement: string, solution: Pick<Solution, "code" | "language">): { problem: Problem; entry: string } {
  const a = parseJsonAnswer(stripThinking(text), specAnswerSchema, "problem spec");
  const entry = a.entry ?? firstFunctionName(solution.code, solution.language);
  if (!entry) throw new ModelOutputError("problem spec: no entry function named, and none found in the code");
  const params = a.params.map((p, i) => ({ name: p.name, type: parseTypeSpec(p.type, `params[${i}].type`) }));
  if (a.examples.length === 0) throw new ModelOutputError("problem spec: no examples, so the oracle could not be checked");
  return {
    entry,
    problem: {
      id: "custom",
      title: a.title,
      statement,
      params,
      returns: a.returns,
      examples: a.examples,
      compare: a.compare,
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      references: a.references,
    },
  };
}
