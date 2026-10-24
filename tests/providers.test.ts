import { describe, expect, it } from "vitest";
import { extractCode, extractExplanation, extractJson, stripThinking } from "@/lib/agent/parse";
import { makeExecutor, resolveMode } from "@/lib/agent/setup";
import { modelConfigFromEnv, modelFor } from "@/lib/models/config";
import { NebiusProvider } from "@/lib/models/nebius";
import { costUsd } from "@/lib/models/pricing";
import { RecordingProvider, ReplayProvider } from "@/lib/models/replay";
import { needsResearch, TavilyClient } from "@/lib/research/tavily";

const req = { model: "m", purpose: "oracle" as const, messages: [{ role: "user" as const, content: "hello" }], replayKey: "p" };

describe("Nebius Token Factory provider", () => {
  it("calls the OpenAI-compatible endpoint and reads usage", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json({ model: "nvidia/x", choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 12, completion_tokens: 3 } });
    }) as unknown as typeof fetch;
    const p = new NebiusProvider("sk-test", "https://api.tokenfactory.nebius.com/v1/", fetchImpl);
    const r = await p.complete(req);
    expect(seen!.url).toBe("https://api.tokenfactory.nebius.com/v1/chat/completions");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({ model: "m", messages: req.messages });
    expect(r).toMatchObject({ text: "hi", promptTokens: 12, completionTokens: 3, simulated: false });
  });

  it("surfaces HTTP errors with the model id", async () => {
    const p = new NebiusProvider("k", undefined, (async () => new Response("bad model", { status: 404 })) as unknown as typeof fetch);
    await expect(p.complete(req)).rejects.toThrow(/404 for m: bad model/);
  });

  it("is only built when a key is present", () => {
    expect(NebiusProvider.fromEnv({})).toBeNull();
    expect(resolveMode({})).toBe("replay");
    expect(resolveMode({ NEBIUS_API_KEY: "k" })).toBe("live");
    expect(resolveMode({ NEBIUS_API_KEY: "k", REPLAY: "1" })).toBe("replay");
  });
});

describe("replay provider", () => {
  it("is deterministic, picks per-attempt responses and falls back to problem keys", async () => {
    const p = new ReplayProvider({ p: { oracle: ["a", "b"] } }, (k) => [k.split("/")[0]]);
    expect((await p.complete(req)).text).toBe("a");
    expect((await p.complete({ ...req, attempt: 1 })).text).toBe("b");
    expect((await p.complete({ ...req, attempt: 5 })).text).toBe("b");
    expect((await p.complete({ ...req, replayKey: "p/sol" })).text).toBe("a");
    const r1 = await p.complete(req);
    const r2 = await p.complete(req);
    expect(r1).toEqual(r2);
    expect(r1.simulated).toBe(true);
    await expect(p.complete({ ...req, replayKey: "zzz" })).rejects.toThrow(/no recorded "oracle"/);
  });

  it("recording provider captures live responses as fixtures", async () => {
    const rec = new RecordingProvider(new ReplayProvider({ p: { oracle: "x" } }));
    await rec.complete(req);
    await rec.complete(req);
    expect(rec.recorded).toEqual({ p: { oracle: ["x", "x"] } });
  });
});

describe("routing and pricing", () => {
  it("routes by role, or everything to Ultra", () => {
    const cfg = modelConfigFromEnv({ MODEL_REASONING: "ultra", MODEL_FAST: "nano" });
    expect(modelFor(cfg, "reasoning")).toBe("ultra");
    expect(modelFor(cfg, "fast")).toBe("nano");
    expect(modelFor({ ...cfg, routing: "ultra-only" }, "fast")).toBe("ultra");
  });

  it("prices tokens per model", () => {
    expect(costUsd("a", 1_000_000, 1_000_000, { a: { in: 1, out: 3 } })).toBe(4);
  });
});

describe("Tavily", () => {
  it("posts the query with a bearer key and maps results", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return Response.json({ results: [{ title: "T", url: "https://x", content: "C" }] });
    }) as unknown as typeof fetch;
    const r = await new TavilyClient("tvly-k", fetchImpl).search("q");
    expect(body.query).toBe("q");
    expect(r).toEqual([{ title: "T", url: "https://x", content: "C" }]);
  });

  it("research triggers only on external references or when forced", () => {
    expect(needsResearch("Sum two numbers.", undefined, "auto")).toBe(false);
    expect(needsResearch("Constraints as on LeetCode 1.", undefined, "auto")).toBe(true);
    expect(needsResearch("x", ["ref"], "auto")).toBe(true);
    expect(needsResearch("LeetCode", ["ref"], "off")).toBe(false);
    expect(needsResearch("x", undefined, "force")).toBe(true);
  });
});

describe("model output parsing", () => {
  it("extracts JSON, code and explanations", () => {
    expect(extractJson('Sure!\n```json\n{"a": [1]}\n```')).toEqual({ a: [1] });
    expect(extractJson('prefix {"b": 2} suffix')).toEqual({ b: 2 });
    expect(() => extractJson("no json")).toThrow();
    expect(extractCode("x\n```py\ndef f(): pass\n```", "python")).toBe("def f(): pass\n");
    expect(extractCode("```text\nnope\n```\n```js\nlet a\n```", "javascript")).toBe("let a\n");
    expect(extractExplanation("EXPLANATION: Two sentences. Really.\n\n```python\nx\n```")).toBe("Two sentences. Really.");
    expect(stripThinking("<think>hmm</think> answer")).toBe("answer");
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
