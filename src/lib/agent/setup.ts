import { FIXTURES, RESEARCH_RESULTS } from "../../fixtures/replay";
import { Judge0Executor } from "../exec/judge0";
import { LocalExecutor } from "../exec/local";
import type { Executor } from "../exec/types";
import { modelConfigFromEnv, type Routing } from "../models/config";
import { NebiusProvider } from "../models/nebius";
import { ReplayProvider, type ReplayFixtures } from "../models/replay";
import type { ModelProvider } from "../models/types";
import { ReplayResearch, TavilyClient, type ResearchClient } from "../research/tavily";
import type { AgentDeps } from "./run";

type Env = Record<string, string | undefined>;

export type Mode = "live" | "replay";

/** Live when NEBIUS_API_KEY is set (unless REPLAY=1), otherwise deterministic replay. */
export function resolveMode(env: Env = process.env, requested?: Mode): Mode {
  if (requested) return requested;
  if (env.REPLAY === "1") return "replay";
  return env.NEBIUS_API_KEY ? "live" : "replay";
}

export function makeProvider(mode: Mode, env: Env = process.env, fixtures: ReplayFixtures = FIXTURES): ModelProvider {
  if (mode === "live") {
    const p = NebiusProvider.fromEnv(env);
    if (!p) throw new Error("live mode needs NEBIUS_API_KEY");
    return p;
  }
  // Solution-level keys look like "problem/solution": fall back to the problem's fixtures.
  return new ReplayProvider(fixtures, (k) => (k.includes("/") ? [k.split("/")[0]] : []));
}

export function makeResearch(mode: Mode, env: Env = process.env): ResearchClient | null {
  if (mode === "live") return TavilyClient.fromEnv(env);
  return new ReplayResearch(RESEARCH_RESULTS);
}

/**
 * Judge0 when JUDGE0_URL is set. Otherwise the local subprocess executor, which
 * is dev-only and refused in production unless ALLOW_LOCAL_EXECUTOR=1.
 */
export function makeExecutor(env: Env = process.env): Executor {
  const j = Judge0Executor.fromEnv(env);
  if (j) return j;
  if (env.NODE_ENV === "production" && env.ALLOW_LOCAL_EXECUTOR !== "1") {
    throw new Error("No sandbox configured: set JUDGE0_URL (the local executor is dev-only).");
  }
  return new LocalExecutor();
}

export function makeDeps(opts: { mode?: Mode; routing?: Routing; env?: Env; fixtures?: ReplayFixtures } = {}): AgentDeps {
  const env = opts.env ?? process.env;
  const mode = resolveMode(env, opts.mode);
  return {
    provider: makeProvider(mode, env, opts.fixtures),
    models: modelConfigFromEnv(env, opts.routing ?? "routed"),
    executor: makeExecutor(env),
    research: makeResearch(mode, env),
  };
}
