import { describe, expect, it } from "vitest";
import { rejectionOf } from "../helpers";
import { makeExecutor, makeProvider, makeResearch, resolveMode } from "@/lib/agent/setup";
import { ReplayMissError, UpstreamError } from "@/lib/errors";
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
    expect(JSON.parse(String(f.seen[0]!.init.body))).toMatchObject({ model: "m", messages: req.messages, max_tokens: 4096 });
    expect(r).toMatchObject({ text: "hi", model: "nvidia/x", promptTokens: 12, completionTokens: 3, simulated: false });
  });

  it("retries rate limits, then succeeds", async () => {
    const f = fetchSequence([() => new Response("rate limited", { status: 429 }), () => Response.json({ choices: [{ message: { content: "ok" } }] })]);
    const r = await new NebiusProvider("k", undefined, f.http).complete(req);
    expect(r.text).toBe("ok");
    expect(r.promptTokens).toBe(0); // usage missing: reported as 0, not invented
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
    expect(() => makeExecutor({ NODE_ENV: "production" })).toThrow(/JUDGE0_URL/);
    expect(makeExecutor({ NODE_ENV: "production", ALLOW_LOCAL_EXECUTOR: "1" }).name).toBe("local");
  });
});
