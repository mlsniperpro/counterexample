import { exactIntegersSupported } from "../core/compare";
import { ConfigError } from "../errors";
import { FIXTURES, RESEARCH_RESULTS } from "../../fixtures/replay";
import { Judge0Executor } from "../exec/judge0";
import { LocalExecutor } from "../exec/local";
import type { Executor } from "../exec/types";
import { modelConfigFromEnv, type Routing } from "../models/config";
import { priceTable } from "../models/pricing";
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
  return new ReplayProvider(fixtures, replayFallbacks);
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
    // A ConfigError, so the API answers with this remedy instead of a bare "Server unavailable."
    throw new ConfigError("no sandbox configured: set JUDGE0_URL, or ALLOW_LOCAL_EXECUTOR=1 to run code on this machine for a local demo (the local executor is not isolated).");
  }
  return new LocalExecutor();
}

/** Problems with this runtime that every attack should show in its trace; empty when there are none. */
export function startupWarnings(exactIntegers = exactIntegersSupported()): string[] {
  return exactIntegers ? [] : ["This Node.js version cannot read exact big integers from JSON (needs Node 21+): outputs that differ only beyond 2^53 will compare equal, so overflow bugs can be missed. Run on Node 22 or newer."];
}

export function makeDeps(opts: { mode?: Mode; routing?: Routing; env?: Env; fixtures?: ReplayFixtures } = {}): AgentDeps {
  const env = opts.env ?? process.env;
  const mode = resolveMode(env, opts.mode);
  return {
    provider: makeProvider(mode, env, opts.fixtures),
    models: modelConfigFromEnv(env, opts.routing ?? "routed"),
    executor: makeExecutor(env),
    research: makeResearch(mode, env),
    prices: priceTable(env),
    warnings: startupWarnings(),
  };
}

/**
 * Replay lookup order. Solution keys ("problem/solution") fall back to the
 * problem. Research keys ("problem?q=query") fall back to the shared API
 * entry ("api?q=query"), then to the problem.
 */
export function replayFallbacks(key: string): string[] {
  const q = key.indexOf("?q=");
  if (q >= 0) return [`api${key.slice(q)}`, ...replayFallbacks(key.slice(0, q)), key.slice(0, q)].filter((k, i, a) => a.indexOf(k) === i);
  const slash = key.indexOf("/");
  return slash >= 0 ? [key.slice(0, slash)] : [];
}
