import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rejectionOf } from "../helpers";
import { UpstreamError } from "@/lib/errors";
import { backoffMs, DEFAULT_RETRY, postJson, type RetryPolicy } from "@/lib/net/http";

const policy: RetryPolicy = { attempts: 3, timeoutMs: 50, baseDelayMs: 100, maxDelayMs: 1000 };

/** A fake fetch that plays back a script of responses (or thrown errors) and records each call. */
function script(steps: (Response | Error | (() => Promise<Response>))[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const step = steps[calls.length - 1];
    if (!step) throw new Error("no more scripted responses");
    if (step instanceof Error) throw step;
    if (typeof step === "function") return step();
    return step;
  }) as unknown as typeof fetch;
  const slept: number[] = [];
  return { calls, slept, deps: { fetchImpl, sleep: async (ms: number) => void slept.push(ms), random: () => 0.5 } };
}

describe("backoffMs", () => {
  it("is full-jitter exponential, capped, and honours Retry-After seconds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), fc.double({ min: 0, max: 0.999, noNaN: true }), (n, r) => {
        const d = backoffMs(n, policy, null, () => r);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** n));
      }),
    );
    expect(backoffMs(0, policy, "0.5", () => 0)).toBe(500);
    expect(backoffMs(0, policy, "60", () => 0)).toBe(policy.maxDelayMs);
    expect(backoffMs(1, policy, "Wed, 21 Oct 2015 07:28:00 GMT", () => 0.5)).toBe(100); // HTTP-date: falls back to backoff
  });
});

describe("postJson", () => {
  it("returns parsed JSON and sends JSON, auth headers and an idempotency key", async () => {
    const s = script([Response.json({ ok: 1 })]);
    expect(await postJson("tavily", "https://x/y", { q: 1 }, { authorization: "Bearer k" }, policy, s.deps)).toEqual({ ok: 1 });
    const h = s.calls[0]!.init.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer k");
    expect(h["content-type"]).toBe("application/json");
    expect(h["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(s.calls[0]!.init.body))).toEqual({ q: 1 });
  });

  it("retries 429 and 5xx with backoff, reusing the idempotency key", async () => {
    const s = script([new Response("slow down", { status: 429, headers: { "retry-after": "1" } }), new Response("oops", { status: 503 }), Response.json({ ok: 2 })]);
    expect(await postJson("token-factory", "https://x", {}, {}, policy, s.deps)).toEqual({ ok: 2 });
    expect(s.calls).toHaveLength(3);
    expect(s.slept).toEqual([1000, 100]);
    const keys = s.calls.map((c) => (c.init.headers as Record<string, string>)["idempotency-key"]);
    expect(new Set(keys).size).toBe(1);
  });

  it("does not retry other 4xx", async () => {
    const s = script([new Response("bad key", { status: 401 }), Response.json({})]);
    const err = await rejectionOf<UpstreamError>(postJson("tavily", "https://x", {}, {}, policy, s.deps));
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ service: "tavily", status: 401, retryable: false });
    expect(err.message).toMatch(/HTTP 401: bad key/);
    expect(s.calls).toHaveLength(1);
  });

  it("retries network errors and gives up after the attempt budget", async () => {
    const s = script([new TypeError("fetch failed"), new TypeError("fetch failed"), new TypeError("fetch failed")]);
    const err = await rejectionOf<UpstreamError>(postJson("judge0", "https://x", {}, {}, policy, s.deps));
    expect(err).toMatchObject({ service: "judge0", status: null, retryable: true });
    expect(err.message).toMatch(/network error: fetch failed/);
    expect(s.calls).toHaveLength(policy.attempts);
  });

  it("times out a hanging request (real AbortSignal.timeout)", async () => {
    const hang = (init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    const fetchImpl = ((_u: string, init: RequestInit) => hang(init)) as unknown as typeof fetch;
    const err = await rejectionOf<UpstreamError>(postJson("token-factory", "https://x", {}, {}, { ...policy, attempts: 2, timeoutMs: 20 }, { fetchImpl, sleep: async () => {} }));
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toMatch(/timed out after 20ms/);
  });

  it("stops at once, without retrying, when the caller aborts", async () => {
    const ac = new AbortController();
    const fetchImpl = ((_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        ac.abort(new Error("client gone")); // the client leaves while the request is in flight
      })) as unknown as typeof fetch;
    let calls = 0;
    const counting = ((u: string, i: RequestInit) => (calls++, fetchImpl(u, i))) as unknown as typeof fetch;
    await expect(postJson("token-factory", "https://x", {}, {}, policy, { fetchImpl: counting, sleep: async () => {} }, ac.signal)).rejects.toThrow("client gone");
    expect(calls).toBe(1);
    await expect(postJson("token-factory", "https://x", {}, {}, policy, { fetchImpl: counting }, ac.signal)).rejects.toThrow("client gone");
    expect(calls).toBe(1); // already aborted: no request at all
  });

  it("aborts a backoff wait when the caller aborts", async () => {
    const ac = new AbortController();
    const s = script([new Response("busy", { status: 503 }), Response.json({})]);
    const p = postJson("tavily", "https://x", {}, {}, { ...policy, baseDelayMs: 60_000, maxDelayMs: 60_000 }, { fetchImpl: s.deps.fetchImpl, random: () => 1 }, ac.signal);
    setTimeout(() => ac.abort(new Error("stop")), 10);
    await expect(p).rejects.toThrow("stop");
    expect(s.calls).toHaveLength(1);
  });

  it("rejects a 2xx body that is not JSON without retrying", async () => {
    const s = script([new Response("<html>", { status: 200 })]);
    await expect(postJson("tavily", "https://x", {}, {}, policy, s.deps)).rejects.toThrow(/not JSON/);
    expect(s.calls).toHaveLength(1);
  });

  it("has sane defaults", () => {
    expect(DEFAULT_RETRY.attempts).toBeGreaterThan(1);
    expect(DEFAULT_RETRY.timeoutMs).toBeGreaterThan(0);
  });
});
