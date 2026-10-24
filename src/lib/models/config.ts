import type { ModelRole } from "./types";

export const DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1";
export const DEFAULT_REASONING_MODEL = "nvidia/Nemotron-3-Ultra-550b-a55b";
export const DEFAULT_FAST_MODEL = "nvidia/nemotron-3-super-120b-a12b";

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
