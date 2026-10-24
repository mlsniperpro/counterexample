import { beforeEach, describe, expect, it } from "vitest";

// Always replay here, even if a key happens to be set in the environment.
process.env.REPLAY = "1";
import { POST } from "@/app/api/attack/route";
import { checkRateLimit, recordSpend, resetGuards, spendAllowed } from "@/lib/agent/guard";
import { BUILT_INS } from "@/lib/problems/catalog";

beforeEach(() => resetGuards());

const post = (body: unknown, ip = "1.2.3.4") =>
  POST(new Request("http://x/api/attack", { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json" }, body: JSON.stringify(body) }));

async function readNdjson(res: Response) {
  const text = await res.text();
  return text.trim().split("\n").map((l) => JSON.parse(l));
}

describe("POST /api/attack (replay mode)", () => {
  it("streams trace events and then the report", async () => {
    const b = BUILT_INS.find((x) => x.problem.id === "isqrt")!;
    const res = await post({ problemId: "isqrt", code: b.demo.code, language: "javascript" });
    expect(res.headers.get("content-type")).toMatch(/ndjson/);
    const msgs = await readNdjson(res);
    expect(msgs[0]).toMatchObject({ type: "mode", mode: "replay" });
    expect(msgs.filter((m) => m.type === "event").length).toBeGreaterThan(10);
    const report = msgs.at(-1);
    expect(report.type).toBe("report");
    expect(report.report.verdict).toBe("counterexample");
    expect(report.report.counterexample.args).toEqual([2147483647]);
    expect(report.report.trace).toBeUndefined();
  });

  it("rejects custom problems in replay mode and empty code", async () => {
    expect((await post({ statement: "x", code: "def solve(): pass" })).status).toBe(400);
    expect((await post({ problemId: "isqrt", code: "  " })).status).toBe(400);
  });
});

describe("guards", () => {
  it("rate-limits per IP per hour", () => {
    const env = { RATE_LIMIT_PER_HOUR: "2" };
    expect(checkRateLimit("a", 0, env).ok).toBe(true);
    expect(checkRateLimit("a", 1, env).ok).toBe(true);
    expect(checkRateLimit("a", 2, env)).toMatchObject({ ok: false });
    expect(checkRateLimit("b", 2, env).ok).toBe(true);
    expect(checkRateLimit("a", 3_600_001, env).ok).toBe(true);
  });

  it("caps daily model spend and resets the next day", () => {
    const env = { DAILY_SPEND_CAP_USD: "0.5" };
    const day = Date.UTC(2026, 9, 24);
    expect(spendAllowed(day, env)).toBe(true);
    recordSpend(0.6, day);
    expect(spendAllowed(day, env)).toBe(false);
    expect(spendAllowed(day + 86_400_000, env)).toBe(true);
  });
});
