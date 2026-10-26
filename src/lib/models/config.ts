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
