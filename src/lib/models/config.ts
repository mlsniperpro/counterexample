import type { ModelRole } from "./types";

export const DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1";
export const DEFAULT_REASONING_MODEL = "nvidia/Nemotron-3-Ultra-550b-a55b";
export const DEFAULT_FAST_MODEL = "nvidia/nemotron-3-super-120b-a12b";

/**
 * Completion-token caps used when a call sets no maxTokens. Reasoning models
 * spend hidden reasoning tokens against the same limit as the visible answer,
 * so a small cap can end a call with no answer at all (finish_reason "length").
 * The cap is a ceiling, not a target: a model that finishes early costs only what it wrote.
 */
export const MAX_TOKENS_REASONING = 16_384;
export const MAX_TOKENS_FAST = 8_192;

/**
 * Model ids Token Factory has announced it will remove from its serverless API, with the date and its recommended
 * replacement (https://docs.tokenfactory.nebius.com/model-deprecations-november-2026.md). It does not reroute
 * requests, so a removed id fails every call; preflight checks the configured ids against this table.
 */
export const MODEL_REMOVALS: Record<string, { removedOn: string; replacement: string }> = {
  "nvidia/nemotron-3-super-120b-a12b": { removedOn: "2026-11-09", replacement: "nvidia/Nemotron-3.5-Super-VL" },
  "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B": { removedOn: "2026-11-09", replacement: "nvidia/Nemotron-3_5-Lightning" },
};

/** The announced removal of a configured model, as of `now`: whether it is already gone, and what to say. */
export function modelRemoval(model: string, now: Date): { removed: boolean; note: string } | undefined {
  // Ids are matched without case, as Token Factory's model list is (preflight's model check does the same).
  const r = Object.entries(MODEL_REMOVALS).find(([id]) => id.toLowerCase() === model.toLowerCase())?.[1];
  if (!r) return undefined;
  const removed = now.toISOString().slice(0, 10) >= r.removedOn;
  return { removed, note: `${model} ${removed ? "was removed" : "is scheduled for removal"} from Token Factory on ${r.removedOn}; set the model variable to a current id (Token Factory suggests ${r.replacement})` };
}

/** "routed": Ultra for oracle and explanation, Super/Nano for everything else. "ultra-only": Ultra everywhere. */
export type Routing = "routed" | "ultra-only";

export type ModelConfig = { reasoningModel: string; fastModel: string; routing: Routing };

export function modelConfigFromEnv(env: Record<string, string | undefined> = process.env, routing: Routing = "routed"): ModelConfig {
  return {
    reasoningModel: env.MODEL_REASONING || DEFAULT_REASONING_MODEL,
    fastModel: env.MODEL_FAST || DEFAULT_FAST_MODEL,
    routing,
  };
}

export function modelFor(cfg: ModelConfig, role: ModelRole): string {
  if (cfg.routing === "ultra-only") return cfg.reasoningModel;
  return role === "reasoning" ? cfg.reasoningModel : cfg.fastModel;
}
