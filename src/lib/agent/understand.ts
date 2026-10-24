import { parseTypeSpec } from "../core/spec";
import type { CompareMode } from "../core/compare";
import { modelFor, type ModelConfig } from "../models/config";
import type { ModelProvider } from "../models/types";
import type { Problem, Solution } from "../problems/types";
import { extractJson, stripThinking } from "./parse";
import { understandPrompt } from "./prompts";

/**
 * Live mode only: turn a pasted statement into a typed Problem with the fast
 * model. The returned spec is validated like any other model output.
 */
export async function understandProblem(
  statement: string,
  solution: Pick<Solution, "code" | "language">,
  provider: ModelProvider,
  models: ModelConfig,
): Promise<{ problem: Problem; entry: string }> {
  const res = await provider.complete({
    model: modelFor(models, "fast"),
    purpose: "understand",
    messages: understandPrompt(statement, solution.code, solution.language),
    replayKey: "custom",
  });
  const j = extractJson(stripThinking(res.text)) as Record<string, unknown>;
  const params = (j.params as { name: string; type: unknown }[]).map((p, i) => ({ name: String(p.name), type: parseTypeSpec(p.type, `params[${i}]`) }));
  const examples = Array.isArray(j.examples) ? (j.examples as { args: unknown[]; output: unknown }[]).filter((e) => Array.isArray(e.args)) : [];
  const compare: CompareMode = j.compare === "unordered" || j.compare === "float" ? j.compare : "exact";
  const entry = typeof j.entry === "string" && /^[A-Za-z_$][\w$]*$/.test(j.entry) ? j.entry : "solve";
  return {
    entry,
    problem: {
      id: "custom",
      title: String(j.title ?? "Custom problem").slice(0, 80),
      statement,
      params,
      returns: String(j.returns ?? ""),
      examples,
      compare,
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      references: Array.isArray(j.references) ? j.references.filter((r): r is string => typeof r === "string").slice(0, 2) : undefined,
    },
  };
}
