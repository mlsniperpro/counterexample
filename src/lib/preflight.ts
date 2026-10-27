import { z } from "zod";
import { guardConfig } from "./agent/guard";
import { makeExecutor } from "./agent/setup";
import { errorMessage } from "./errors";
import { Judge0Executor } from "./exec/judge0";
import { DEFAULT_BASE_URL, modelConfigFromEnv, modelRemoval } from "./models/config";
import { NebiusProvider } from "./models/nebius";
import { costUsd, priceFor, priceTable } from "./models/pricing";
import { DEFAULT_RETRY, getJson, type HttpDeps } from "./net/http";
import { TavilyClient, TAVILY_BASE_URL, TAVILY_RETRY } from "./research/tavily";

/**
 * Preflight for the live path: run once the owner's credentials arrive
 * (`pnpm preflight`). Every check is a real call against the configured
 * service; a missing credential is a "skip", never a silent pass.
 */
export type CheckStatus = "pass" | "fail" | "skip";
export type Check = { name: string; status: CheckStatus; detail: string };
type Env = Record<string, string | undefined>;

const modelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });
const languagesSchema = z.array(z.object({ id: z.number().int(), name: z.string() }));

const QUICK = { ...DEFAULT_RETRY, attempts: 2, timeoutMs: 60_000 };

export async function preflight(env: Env = process.env, http: HttpDeps = {}, now: Date = new Date()): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, status: CheckStatus, detail: string) => checks.push({ name, status, detail });
  const attempt = async (name: string, fn: () => Promise<string>) => {
    try {
      add(name, "pass", await fn());
    } catch (e) {
      add(name, "fail", errorMessage(e));
    }
  };

  // Configuration that would otherwise only fail at request time.
  await attempt("config: prices and guards", async () => {
    const prices = priceTable(env);
    const g = guardConfig(env);
    return `${Object.keys(prices).length} priced models; ${g.RATE_LIMIT_PER_HOUR}/h per IP, $${g.DAILY_SPEND_CAP_USD}/day cap`;
  });
  // Like the other optional services, an absent sandbox is a skip: production has no sandbox without JUDGE0_URL
  // (the judge0 checks below skip for the same reason). A configured but unusable one still fails.
  const sandboxEnv: Env = { ...env, NODE_ENV: env.NODE_ENV ?? "production" };
  if (!sandboxEnv.JUDGE0_URL && sandboxEnv.NODE_ENV === "production" && sandboxEnv.ALLOW_LOCAL_EXECUTOR !== "1") {
    add("config: sandbox", "skip", "JUDGE0_URL not set (production refuses the local executor unless ALLOW_LOCAL_EXECUTOR=1)");
  } else {
    await attempt("config: sandbox", async () => makeExecutor(sandboxEnv).label);
  }

  // Nebius Token Factory: no configured model is announced for removal (a removed id fails every call, and Token
  // Factory does not reroute), the ids exist, and each answers one tiny prompt.
  const models = modelConfigFromEnv(env);
  const removals = [models.reasoningModel, models.fastModel].flatMap((m) => modelRemoval(m, now) ?? []);
  add(
    "config: model removals",
    removals.some((r) => r.removed) ? "fail" : "pass",
    removals.length ? `${removals.map((r) => r.note).join("; ")} (MODEL_REASONING, MODEL_FAST)` : "no configured model is announced for removal",
  );
  if (!env.NEBIUS_API_KEY) {
    add("token factory: model list", "skip", "NEBIUS_API_KEY not set");
    add("token factory: chat", "skip", "NEBIUS_API_KEY not set");
  } else {
    const base = (env.NEBIUS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
    await attempt("token factory: model list", async () => {
      const raw = modelsSchema.parse(await getJson("token-factory", `${base}/models`, { authorization: `Bearer ${env.NEBIUS_API_KEY}` }, QUICK, http));
      const ids = raw.data.map((m) => m.id);
      const missing = [models.reasoningModel, models.fastModel].filter((m) => !ids.some((id) => id.toLowerCase() === m.toLowerCase()));
      if (missing.length) {
        const nemotron = ids.filter((id) => /nemotron/i.test(id)).join(", ") || "none";
        throw new Error(`not offered: ${missing.join(", ")}. Nemotron models offered: ${nemotron}. Set MODEL_REASONING / MODEL_FAST.`);
      }
      return `${ids.length} models; ${models.reasoningModel} and ${models.fastModel} available`;
    });
    const provider = new NebiusProvider(env.NEBIUS_API_KEY, base, http, QUICK, models.reasoningModel);
    const prices = (() => {
      try {
        return priceTable(env);
      } catch {
        return {};
      }
    })();
    for (const model of new Set([models.reasoningModel, models.fastModel])) {
      await attempt(`token factory: chat ${model}`, async () => {
        const r = await provider.complete({ model, purpose: "understand", replayKey: "preflight", temperature: 0, messages: [{ role: "user", content: "Reply with the word OK." }] });
        if (!r.text.trim()) throw new Error("empty answer");
        const cost = costUsd(r.model, r.promptTokens, r.completionTokens, prices);
        if (!priceFor(model, prices)) throw new Error(`answered in ${r.latencyMs} ms, but ${model} has no price: set MODEL_PRICES`);
        return `answered "${r.text.trim().slice(0, 20)}" in ${r.latencyMs} ms, ${r.promptTokens}+${r.completionTokens} tokens, $${(cost ?? 0).toFixed(6)}`;
      });
    }
  }

  // Tavily: one real search.
  if (!env.TAVILY_API_KEY) {
    add("tavily: search", "skip", "TAVILY_API_KEY not set (research stage disabled in live mode)");
  } else {
    await attempt("tavily: search", async () => {
      const client = new TavilyClient(env.TAVILY_API_KEY as string, http, { ...TAVILY_RETRY, attempts: 2 }, env.TAVILY_BASE_URL || TAVILY_BASE_URL);
      const r = await client.search("LeetCode 704 Binary Search constraints");
      if (r.results.length === 0) throw new Error("no results");
      return `${r.results.length} results (${r.dropped} dropped), first: ${r.results[0]?.url}`;
    });
  }

  // Judge0: the language ids exist, and the harness runs in both languages.
  if (!env.JUDGE0_URL) {
    add("judge0: languages", "skip", "JUDGE0_URL not set (production refuses the local executor)");
    add("judge0: run", "skip", "JUDGE0_URL not set");
  } else {
    let executor: Judge0Executor | null = null;
    try {
      executor = Judge0Executor.fromEnv(env);
    } catch (e) {
      add("judge0: config", "fail", errorMessage(e));
    }
    const ids = { python: Number(env.JUDGE0_LANG_PYTHON || 71), javascript: Number(env.JUDGE0_LANG_JAVASCRIPT || 63) };
    await attempt("judge0: languages", async () => {
      const headers = executor?.headers() ?? {};
      const langs = languagesSchema.parse(await getJson("judge0", `${(env.JUDGE0_URL as string).replace(/\/+$/, "")}/languages`, headers, QUICK, http));
      const name = (id: number) => langs.find((l) => l.id === id)?.name;
      const py = name(ids.python);
      const js = name(ids.javascript);
      if (!py || !/python/i.test(py)) throw new Error(`language ${ids.python} is ${py ?? "missing"}, not Python: set JUDGE0_LANG_PYTHON`);
      if (!js || !/javascript|node/i.test(js)) throw new Error(`language ${ids.javascript} is ${js ?? "missing"}, not JavaScript: set JUDGE0_LANG_JAVASCRIPT`);
      return `${py}; ${js}`;
    });
    await attempt("judge0: run", async () => {
      if (!executor) throw new Error("JUDGE0_URL is set but no executor was built");
      const programs = [
        { language: "python" as const, code: "def solve(x):\n    return x + 1\n" },
        { language: "javascript" as const, code: "function solve(x) { return x + 1; }" },
      ];
      const timings: string[] = [];
      for (const p of programs) {
        const r = await executor.run({ ...p, entry: "solve", inputs: [[1], [41]], timeLimitMs: 1000, memoryLimitMb: 256 });
        const outs = r.outcomes.map((o) => (o.ok ? o.out : `${o.error}: ${o.message}`));
        if (JSON.stringify(outs) !== "[2,42]") throw new Error(`${p.language} returned ${JSON.stringify(outs)}`);
        timings.push(`${p.language} ${r.wallMs} ms`);
      }
      return `harness runs: ${timings.join(", ")}`;
    });
  }
  return checks;
}

export function formatChecks(checks: Check[]): string {
  const icon = { pass: "PASS", fail: "FAIL", skip: "skip" } as const;
  return checks.map((c) => `${icon[c.status]}  ${c.name.padEnd(48)} ${c.detail}`).join("\n");
}
