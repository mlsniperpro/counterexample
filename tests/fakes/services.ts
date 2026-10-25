/**
 * Fake Token Factory, Tavily and Judge0 HTTP servers for testing the live path
 * end to end over real HTTP. The fake model answers from the replay fixtures
 * (purpose and problem are read from the prompt), the fake Tavily from the
 * recorded search results. Code runs in the real Counterexample sandbox
 * (sandbox/server.mjs), the Judge0-compatible server we deploy, with bearer auth.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createSandboxServer } from "../../sandbox/server.mjs";
import { FIXTURES, RESEARCH_RESULTS } from "@/fixtures/replay";
import { PROBLEMS } from "@/lib/problems/catalog";

export type FakeOptions = {
  /** Model ids the fake Token Factory offers. */
  models?: string[];
  /** Answer the first N chat calls with 429 (to exercise retries over real HTTP). */
  rateLimitFirst?: number;
  /** Bearer token / auth token each service requires. */
  keys?: { nebius: string; tavily: string; judge0: string };
};

export type Fakes = { url: string; sandboxUrl: string; close: () => Promise<void>; calls: { path: string; status: number }[] };

const PURPOSES: [RegExp, "oracle" | "generators" | "explain" | "research" | "understand"][] = [
  [/SLOW BUT OBVIOUSLY CORRECT/, "oracle"],
  [/Design adversarial input GENERATORS/, "generators"],
  [/This solution is wrong\. Minimal counterexample/, "explain"],
  [/Web search results:/, "research"],
  [/Turn this problem statement into a typed spec/, "understand"],
];

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, json: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(json));
}

let nextUidBlock = 0;

export async function startFakes(opts: FakeOptions = {}): Promise<Fakes> {
  const keys = opts.keys ?? { nebius: "nb-test", tavily: "tv-test", judge0: "j0-test" };
  const models = opts.models ?? ["nvidia/Nemotron-3-Ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b", "meta/other-model"];
  let rateLimited = opts.rateLimitFirst ?? 0;
  const calls: Fakes["calls"] = [];
  const server: Server = createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    const reply = (status: number, json: unknown) => {
      calls.push({ path, status });
      send(res, status, json);
    };
    try {
      if (path.startsWith("/v1/")) {
        if (req.headers.authorization !== `Bearer ${keys.nebius}`) return reply(401, { error: "bad key" });
        if (req.method === "GET" && path === "/v1/models") return reply(200, { object: "list", data: models.map((id) => ({ id, object: "model" })) });
        if (req.method === "POST" && path === "/v1/chat/completions") {
          const j = JSON.parse(await body(req)) as { model: string; messages: { content: string }[] };
          if (!models.includes(j.model)) return reply(404, { error: `model ${j.model} not found` });
          if (rateLimited > 0) {
            rateLimited--;
            res.setHeader("retry-after", "0");
            return reply(429, { error: "rate limited" });
          }
          const prompt = j.messages.map((m) => m.content).join("\n");
          let text = "OK";
          const purpose = PURPOSES.find(([re]) => re.test(prompt))?.[1];
          if (purpose === "understand") {
            const p = PROBLEMS.find((x) => prompt.includes(x.statement));
            if (!p) return reply(500, { error: "fake understands only catalog statements" });
            text = "```json\n" + JSON.stringify({ title: p.title, entry: "solve", params: p.params, returns: p.returns, examples: p.examples, compare: p.compare }) + "\n```";
          } else if (purpose) {
            const title = /Problem: (.+)/.exec(prompt)?.[1]?.trim();
            const id = PROBLEMS.find((p) => p.title === title)?.id;
            const fx = id ? FIXTURES[id]?.[purpose] : undefined;
            if (!fx) return reply(500, { error: `fake has no ${purpose} answer for ${title}` });
            text = Array.isArray(fx) ? (fx[0] ?? "") : fx;
          }
          return reply(200, {
            id: "chatcmpl-fake",
            model: j.model,
            choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
            usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(text.length / 4) },
          });
        }
      }
      if (path === "/tavily/search" && req.method === "POST") {
        if (req.headers.authorization !== `Bearer ${keys.tavily}`) return reply(401, { error: "bad key" });
        const j = JSON.parse(await body(req)) as { query: string };
        const hit = RESEARCH_RESULTS[j.query] ?? RESEARCH_RESULTS["LeetCode 704 Binary Search official constraints"] ?? [];
        return reply(200, { query: j.query, results: hit.map((r) => ({ ...r, score: 0.9 })) });
      }
      reply(404, { error: `no route ${req.method} ${path}` });
    } catch (e) {
      reply(500, { error: String(e) });
    }
  });
  // Its own uid range (runs are killed by uid), so parallel test processes cannot kill each other's runs.
  const sandbox = createSandboxServer({ token: keys.judge0, uidBase: 3_000_000 + (process.pid % 100_000) * 64 + (nextUidBlock++ % 4) * 16 });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => sandbox.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const sandboxPort = (sandbox.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    sandboxUrl: `http://127.0.0.1:${sandboxPort}`,
    calls,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await new Promise<void>((r) => sandbox.close(() => r()));
    },
  };
}

/** Env that points every live client at the fakes. */
export function fakeEnv(f: Fakes, keys = { nebius: "nb-test", tavily: "tv-test", judge0: "j0-test" }): Record<string, string> {
  return {
    NEBIUS_API_KEY: keys.nebius,
    NEBIUS_BASE_URL: `${f.url}/v1`,
    TAVILY_API_KEY: keys.tavily,
    TAVILY_BASE_URL: `${f.url}/tavily`,
    JUDGE0_URL: f.sandboxUrl,
    JUDGE0_TOKEN: keys.judge0,
    JUDGE0_AUTH: "bearer",
  };
}
