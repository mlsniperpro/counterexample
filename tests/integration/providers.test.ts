import { describe, expect, it } from "vitest";
import { rejectionOf } from "../helpers";
import { makeExecutor, makeProvider, makeResearch, resolveMode } from "@/lib/agent/setup";
import { ConfigError, ModelOutputError, ReplayMissError, UpstreamError } from "@/lib/errors";
import { DEFAULT_REASONING_MODEL, MAX_TOKENS_FAST, MAX_TOKENS_REASONING } from "@/lib/models/config";
import { NebiusProvider } from "@/lib/models/nebius";
import { RecordingProvider, ReplayProvider } from "@/lib/models/replay";
import { ReplayResearch, TavilyClient } from "@/lib/research/tavily";

const req = { model: "m", purpose: "oracle" as const, messages: [{ role: "user" as const, content: "hello" }], replayKey: "p" };
const noSleep = async () => {};

function fetchSequence(responses: (() => Response)[]) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const next = responses[Math.min(seen.length - 1, responses.length - 1)];
    return next!();
  }) as unknown as typeof fetch;
  return { seen, http: { fetchImpl, sleep: noSleep } };
}

describe("Nebius Token Factory provider", () => {
  it("calls the OpenAI-compatible endpoint and reads usage", async () => {
    const f = fetchSequence([() => Response.json({ model: "nvidia/x", choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 12, completion_tokens: 3 } })]);
    const p = new NebiusProvider("sk-test", "https://api.tokenfactory.nebius.com/v1/", f.http);
    const r = await p.complete(req);
    expect(f.seen[0]!.url).toBe("https://api.tokenfactory.nebius.com/v1/chat/completions");
    expect((f.seen[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(JSON.parse(String(f.seen[0]!.init.body))).toMatchObject({ model: "m", messages: req.messages, max_tokens: 8192 });
    expect(r).toMatchObject({ text: "hi", model: "nvidia/x", promptTokens: 12, completionTokens: 3, simulated: false, unmetered: false });
  });

  describe("max_tokens (hidden reasoning counts against it)", () => {
    const ok = () => Response.json({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const sentMaxTokens = async (p: NebiusProvider, f: ReturnType<typeof fetchSequence>, r: Parameters<NebiusProvider["complete"]>[0]) => {
      await p.complete(r);
      return (JSON.parse(String(f.seen.at(-1)!.init.body)) as { max_tokens: number }).max_tokens;
    };

    it("defaults to 16384 for the reasoning model and 8192 for a fast one", async () => {
      expect([MAX_TOKENS_REASONING, MAX_TOKENS_FAST]).toEqual([16384, 8192]);
      const f = fetchSequence([ok]);
      const p = new NebiusProvider("k", undefined, f.http);
      expect(await sentMaxTokens(p, f, { ...req, model: DEFAULT_REASONING_MODEL })).toBe(16384);
      expect(await sentMaxTokens(p, f, { ...req, model: DEFAULT_REASONING_MODEL.toUpperCase() })).toBe(16384);
      expect(await sentMaxTokens(p, f, { ...req, model: "nvidia/nemotron-3-super-120b-a12b" })).toBe(8192);
    });

    it("follows MODEL_REASONING from the environment, so ultra-only routing gets the larger cap on every call", async () => {
      const f = fetchSequence([ok]);
      const p = new NebiusProvider("k", undefined, f.http, undefined, "acme/big-thinker");
      expect(await sentMaxTokens(p, f, { ...req, model: "acme/big-thinker" })).toBe(16384);
      expect(await sentMaxTokens(p, f, { ...req, model: DEFAULT_REASONING_MODEL })).toBe(8192);
      expect(NebiusProvider.fromEnv({ NEBIUS_API_KEY: "k", MODEL_REASONING: "acme/big-thinker" })?.maxTokensFor("acme/big-thinker")).toBe(16384);
      expect(NebiusProvider.fromEnv({ NEBIUS_API_KEY: "k" })?.maxTokensFor(DEFAULT_REASONING_MODEL)).toBe(16384);
    });

    it("lets one call choose its own limit", async () => {
      const f = fetchSequence([ok]);
      const p = new NebiusProvider("k", undefined, f.http);
      expect(await sentMaxTokens(p, f, { ...req, model: DEFAULT_REASONING_MODEL, maxTokens: 64 })).toBe(64);
      expect(await sentMaxTokens(p, f, { ...req, maxTokens: 20_000 })).toBe(20_000);
    });

    it("turns finish_reason length with no content into a typed model-output error naming the limit", async () => {
      for (const message of [{ content: "" }, { content: null }, { content: "  \n" }, {}]) {
        const f = fetchSequence([() => Response.json({ choices: [{ message, finish_reason: "length" }], usage: { prompt_tokens: 5, completion_tokens: 8192 } })]);
        const err = await rejectionOf<ModelOutputError>(new NebiusProvider("k", undefined, f.http).complete(req));
        expect(err).toBeInstanceOf(ModelOutputError);
        expect(err.code).toBe("model_output");
        expect(err.message).toBe(
          'token-factory: m hit the max_tokens limit (8192) before it wrote any answer (finish_reason "length"; hidden reasoning counts against the limit). Raise the limit: MAX_TOKENS_REASONING / MAX_TOKENS_FAST in src/lib/models/config.ts, or maxTokens on the call.',
        );
        expect(f.seen).toHaveLength(1); // not retried: the same request would fail the same way
      }
    });

    it("reports why the model stopped and the limit the call ran under, so a cut answer can be told from a finished one", async () => {
      const cut = fetchSequence([() => Response.json({ choices: [{ message: { content: "<think>unclosed" }, finish_reason: "length" }] })]);
      const r = await new NebiusProvider("k", undefined, cut.http).complete({ ...req, maxTokens: 123 });
      expect(r).toMatchObject({ text: "<think>unclosed", finishReason: "length", maxTokens: 123 });
      const done = fetchSequence([() => Response.json({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] })]);
      expect((await new NebiusProvider("k", undefined, done.http).complete(req)).finishReason).toBe("stop");
      const none = fetchSequence([() => Response.json({ choices: [{ message: { content: "hi" } }] })]);
      expect(await new NebiusProvider("k", undefined, none.http).complete(req)).not.toHaveProperty("finishReason");
    });

    it("still returns a truncated but non-empty answer, and an empty one that did not hit the limit", async () => {
      const cut = fetchSequence([() => Response.json({ choices: [{ message: { content: "```python\ndef solve(" }, finish_reason: "length" }] })]);
      expect((await new NebiusProvider("k", undefined, cut.http).complete(req)).text).toBe("```python\ndef solve(");
      const stop = fetchSequence([() => Response.json({ choices: [{ message: { content: "" }, finish_reason: "stop" }] })]);
      expect((await new NebiusProvider("k", undefined, stop.http).complete(req)).text).toBe("");
    });
  });

  it("retries rate limits, then succeeds", async () => {
    const f = fetchSequence([() => new Response("rate limited", { status: 429 }), () => Response.json({ choices: [{ message: { content: "ok" } }] })]);
    const r = await new NebiusProvider("k", undefined, f.http).complete(req);
    expect(r.text).toBe("ok");
    expect(r.promptTokens).toBe(0); // usage missing: reported as 0, not invented...
    expect(r.unmetered).toBe(true); // ...and flagged, so the call is charged as unpriced rather than free
    expect(f.seen).toHaveLength(2);
  });

  it("fails with a typed error on a bad model id, and never leaks the key", async () => {
    const f = fetchSequence([() => new Response("model not found", { status: 404 })]);
    const err = await rejectionOf<UpstreamError>(new NebiusProvider("sk-secret", undefined, f.http).complete(req));
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toMatch(/token-factory: HTTP 404: model not found/);
    expect(err.message).not.toContain("sk-secret");
  });

  it("rejects a response without choices", async () => {
    const f = fetchSequence([() => Response.json({ choices: [] })]);
    await expect(new NebiusProvider("k", undefined, f.http).complete(req)).rejects.toThrow(/unexpected response shape/);
  });

  it("is only built when a key is present", () => {
    expect(NebiusProvider.fromEnv({})).toBeNull();
    expect(NebiusProvider.fromEnv({ NEBIUS_API_KEY: "k" })).toBeInstanceOf(NebiusProvider);
    expect(resolveMode({})).toBe("replay");
    expect(resolveMode({ NEBIUS_API_KEY: "k" })).toBe("live");
    expect(resolveMode({ NEBIUS_API_KEY: "k", REPLAY: "1" })).toBe("replay");
    expect(() => makeProvider("live", {})).toThrow(/NEBIUS_API_KEY/);
  });
});

describe("pricing lookups", () => {
  it("match model ids case-insensitively", async () => {
    const { priceFor } = await import("@/lib/models/pricing");
    expect(priceFor("NVIDIA/nemotron-3-ultra-550B-A55B", { "nvidia/Nemotron-3-Ultra-550b-a55b": { in: 1, out: 3 } })).toEqual({ in: 1, out: 3 });
    expect(priceFor("other", {})).toBeUndefined();
  });
});

describe("replay provider", () => {
  it("is deterministic, picks per-attempt responses and falls back to problem keys", async () => {
    const p = new ReplayProvider({ p: { oracle: ["a", "b"] } }, (k) => [k.slice(0, k.indexOf("/"))]);
    expect((await p.complete(req)).text).toBe("a");
    expect((await p.complete({ ...req, attempt: 1 })).text).toBe("b");
    expect((await p.complete({ ...req, attempt: 5 })).text).toBe("b");
    expect((await p.complete({ ...req, replayKey: "p/sol" })).text).toBe("a");
    expect(await p.complete(req)).toEqual(await p.complete(req));
    expect((await p.complete(req)).simulated).toBe(true);
    await expect(p.complete({ ...req, replayKey: "zzz" })).rejects.toThrow(ReplayMissError);
    await expect(new ReplayProvider({ p: { oracle: [] } }).complete(req)).rejects.toThrow(/empty response list/);
  });

  it("simulates slower decoding for Ultra than for Super", async () => {
    const p = new ReplayProvider({ p: { oracle: "x".repeat(400) } });
    const ultra = await p.complete({ ...req, model: "nvidia/Nemotron-3-Ultra-550b-a55b" });
    const fast = await p.complete({ ...req, model: "nvidia/nemotron-3-super-120b-a12b" });
    expect(ultra.latencyMs).toBeGreaterThan(fast.latencyMs);
  });

  it("recording provider captures responses as fixtures", async () => {
    const rec = new RecordingProvider(new ReplayProvider({ p: { oracle: "x" } }));
    await rec.complete(req);
    await rec.complete(req);
    expect(rec.recorded).toEqual({ p: { oracle: ["x", "x"] } });
  });
});

describe("Tavily", () => {
  it("posts the query with a bearer key and maps results", async () => {
    const f = fetchSequence([() => Response.json({ results: [{ title: "T", url: "https://x.example/", content: "C" }] })]);
    const r = await new TavilyClient("tvly-k", f.http).search("q".repeat(1000));
    expect(f.seen[0]!.url).toBe("https://api.tavily.com/search");
    expect(JSON.parse(String(f.seen[0]!.init.body)).query).toHaveLength(400);
    expect(r).toEqual({ results: [{ title: "T", url: "https://x.example/", content: "C" }], dropped: 0 });
  });

  it("drops (and counts) results with non-http(s) URLs or a bad shape, keeping the rest", async () => {
    const f = fetchSequence([() => Response.json({ results: [{ url: "javascript:alert(1)" }, { title: null, url: "https://ok.example/", content: null }, { url: 42 }] })]);
    expect(await new TavilyClient("k", f.http).search("q")).toEqual({ results: [{ title: "", url: "https://ok.example/", content: "" }], dropped: 2 });
    await expect(new TavilyClient("k", fetchSequence([() => Response.json({ results: "nope" })]).http).search("q")).rejects.toThrow(/unexpected response shape/);
    await expect(new TavilyClient("k", fetchSequence([() => new Response("bad key", { status: 401 })]).http).search("q")).rejects.toThrow(/HTTP 401/);
  });

  it("replay research serves recorded results only", async () => {
    const r = new ReplayResearch({ q: [] });
    expect(await r.search("q")).toEqual({ results: [], dropped: 0 });
    await expect(r.search("other")).rejects.toThrow(ReplayMissError);
    expect(makeResearch("live", {})).toBeNull();
    expect(makeResearch("replay", {})?.name).toBe("replay");
  });
});

describe("executor selection", () => {
  it("prefers Judge0, refuses the local executor in production", () => {
    expect(makeExecutor({ JUDGE0_URL: "https://j.example" }).name).toBe("judge0");
    expect(makeExecutor({ NODE_ENV: "development" }).name).toBe("local");
    expect(() => makeExecutor({ NODE_ENV: "production" })).toThrow(/JUDGE0_URL, or ALLOW_LOCAL_EXECUTOR=1/);
    // A ConfigError, which the API reports with its message (a plain Error became a bare "Server unavailable.").
    expect(() => makeExecutor({ NODE_ENV: "production" })).toThrow(ConfigError);
    // The API shows a ConfigError's message to its caller: it names the variable, never its value.
    for (const env of [{ JUDGE0_URL: "https://admin:s3cr3t-token@sandbox host.example.com:2358" }, { JUDGE0_URL: "https://j.example", JUDGE0_AUTH: "s3cr3t-token" }]) {
      const message = (() => {
        try {
          makeExecutor(env);
          return "";
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      })();
      expect(message).toMatch(/JUDGE0_/);
      expect(message).not.toMatch(/s3cr3t/);
    }
    expect(makeExecutor({ NODE_ENV: "production", ALLOW_LOCAL_EXECUTOR: "1" }).name).toBe("local");
  });
});
