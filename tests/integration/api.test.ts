import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/attack/route";
import { attackBodySchema, problemsPayload, resetGuardForTests, spentBy } from "@/lib/agent/api";
import { BUILT_INS } from "@/lib/problems/catalog";

const saved = { ...process.env };
beforeEach(() => {
  // Always replay here, even if a key happens to be set in the environment.
  process.env.REPLAY = "1";
  delete process.env.RATE_LIMIT_PER_HOUR;
  resetGuardForTests();
});
afterEach(() => {
  process.env = { ...saved };
  resetGuardForTests();
});

const isqrt = BUILT_INS.find((x) => x.problem.id === "isqrt")!;
const post = (body: unknown, init: { ip?: string; signal?: AbortSignal } = {}) =>
  POST(
    new Request("http://x/api/attack", {
      method: "POST",
      headers: { "x-real-ip": init.ip ?? "1.2.3.4", "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: init.signal,
    }),
  );
const lines = async (res: Response) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l));

describe("POST /api/attack (replay mode)", () => {
  it("streams the mode, trace events and then the report (without the trace)", async () => {
    const res = await post({ problemId: "isqrt", code: isqrt.demo.code, language: "javascript" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/ndjson/);
    const msgs = await lines(res);
    expect(msgs[0]).toMatchObject({ type: "mode", mode: "replay", problem: { id: "isqrt" } });
    expect(msgs.filter((m) => m.type === "event").length).toBeGreaterThan(10);
    const last = msgs.at(-1);
    expect(last.type).toBe("report");
    expect(last.report.verdict).toBe("counterexample");
    expect(last.report.counterexample.args).toEqual([2147483647]);
    expect(last.report.trace).toBeUndefined();
  });

  it("researches the web only when asked (research=force) or when the statement cites sources", async () => {
    const body = { problemId: "isqrt", code: isqrt.demo.code, language: "javascript" };
    const auto = (await lines(await post(body))).at(-1).report;
    expect(auto.research).toBeUndefined();
    const forced = (await lines(await post({ ...body, research: "force" }, { ip: "5.5.5.5" }))).at(-1).report;
    expect(forced.research.queries).toEqual(["Integer square root constraints edge cases"]);
    expect(forced.research.facts.length).toBeGreaterThan(0);
    expect(forced.research.influencedFamilies).toContain("int32-bounds");
  });

  it("validates the body against the schema before doing any work", async () => {
    const cases: [unknown, RegExp][] = [
      ["{not json", /expected object/i],
      [{ problemId: "isqrt", code: "  ", language: "javascript" }, /Paste a solution/],
      [{ problemId: "isqrt", code: "x".repeat(20_001), language: "javascript" }, /20,000/],
      [{ problemId: "isqrt", code: "x", language: "ruby" }, /python|javascript/],
      [{ code: "x", language: "python" }, /Pick a built-in problem/],
      [{ problemId: "", code: "x", language: "python" }, /too small|at least/i],
      [{ problemId: "nope", code: "x", language: "python" }, /Unknown problem/],
      [{ statement: "x", code: "def solve(): pass", language: "python" }, /Replay mode/],
    ];
    for (const [body, re] of cases) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect((await res.json()).error).toMatch(re);
    }
  });

  it("rate-limits per IP with 429 and Retry-After", async () => {
    process.env.RATE_LIMIT_PER_HOUR = "1";
    resetGuardForTests();
    const first = await post({ problemId: "isqrt", code: isqrt.demo.code, language: "javascript" }, { ip: "9.9.9.9" });
    await first.text();
    const second = await post({ problemId: "isqrt", code: isqrt.demo.code, language: "javascript" }, { ip: "9.9.9.9" });
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
    const other = await post({ problemId: "isqrt", code: isqrt.demo.code, language: "javascript" }, { ip: "8.8.8.8" });
    expect(other.status).toBe(200);
    await other.text();
  });

  it("returns 503 with the reason when the server is misconfigured", async () => {
    process.env.MODEL_PRICES = "{broken";
    const res = await post({ problemId: "isqrt", code: isqrt.demo.code, language: "javascript" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/misconfigured: MODEL_PRICES/);
    delete process.env.MODEL_PRICES;
    process.env.RATE_LIMIT_PER_HOUR = "many";
    resetGuardForTests();
    const bad = await post({ problemId: "isqrt", code: isqrt.demo.code, language: "javascript" });
    expect(bad.status).toBe(503);
    expect((await bad.json()).error).toMatch(/misconfigured: guard settings/);
  });

  it("stops the attack when the client disconnects", async () => {
    const ac = new AbortController();
    const res = await post({ problemId: "binary-search", code: BUILT_INS[0]!.demo.code, language: "python" }, { signal: ac.signal });
    ac.abort();
    const msgs = await lines(res);
    expect(msgs.at(-1)).toMatchObject({ type: "report", report: { verdict: "error", message: expect.stringMatching(/cancelled/) } });
  });
});

describe("GET /api/problems payload", () => {
  it("reports the mode and the built-in problems without their bug notes", () => {
    const j = JSON.parse(JSON.stringify(problemsPayload("replay")));
    expect(j.mode).toBe("replay");
    expect(j.problems).toHaveLength(5);
    expect(JSON.stringify(j)).not.toMatch(/"bug"/);
  });
});

describe("spentBy", () => {
  it("prices a call, or counts it as unpriced", () => {
    const res = { text: "", model: "m", promptTokens: 1_000_000, completionTokens: 0, latencyMs: 0, simulated: false };
    expect(spentBy(res, { m: { in: 2, out: 0 } })).toEqual({ costUsd: 2, unpricedCalls: 0 });
    expect(spentBy(res, {})).toEqual({ costUsd: 0, unpricedCalls: 1 });
  });
});

describe("attackBodySchema", () => {
  it("applies defaults and keeps code whitespace", () => {
    const b = attackBodySchema.parse({ problemId: "isqrt", code: "  x\n", language: "python" });
    expect(b).toMatchObject({ routing: "routed", research: "auto", code: "  x\n" });
  });
});
