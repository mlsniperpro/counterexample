import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/attack/route";
import { getGuard, PUBLIC_BUDGETS, resetGuardForTests } from "@/lib/agent/api";
import { worstCaseAttackUsd } from "@/lib/agent/guard";
import { modelConfigFromEnv } from "@/lib/models/config";
import { priceTable } from "@/lib/models/pricing";
import { BUILT_INS } from "@/lib/problems/catalog";
import { fakeEnv, startFakes, type Fakes } from "../fakes/services";

// attack() never throws by design; this stands in for a bug that makes it throw after spending.
vi.mock("@/lib/agent/run", () => ({ attack: vi.fn(async () => Promise.reject(new Error("bug after spending"))) }));

let fakes: Fakes;
beforeAll(async () => {
  fakes = await startFakes({});
});
afterAll(async () => fakes.close());
afterEach(() => {
  vi.unstubAllEnvs();
  resetGuardForTests();
});

describe("POST /api/attack when the attack crashes", () => {
  it("keeps the whole live reservation charged, frees the slot, and reports the error", async () => {
    for (const [k, v] of Object.entries(fakeEnv(fakes))) vi.stubEnv(k, v);
    vi.stubEnv("REPLAY", undefined);
    vi.stubEnv("VERCEL", "1");
    resetGuardForTests();
    const models = modelConfigFromEnv(process.env);
    const reserve = worstCaseAttackUsd(PUBLIC_BUDGETS.maxModelCalls, [models.reasoningModel, models.fastModel], priceTable(process.env), getGuard().config.UNPRICED_CALL_USD);
    const isqrt = BUILT_INS.find((b) => b.problem.id === "isqrt")!;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(new Request("http://x/api/attack", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "7.7.10.1" }, body: JSON.stringify({ problemId: "isqrt", code: isqrt.demo.code, language: "javascript" }) }));
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    errors.mockRestore();
    expect(lines.at(-1)).toEqual({ type: "error", error: "bug after spending" });
    expect(getGuard().activeAttacks).toBe(0);
    expect(reserve).toBeGreaterThan(0);
    expect(getGuard().spentUsd(Date.now())).toBeCloseTo(reserve, 9);
  });
});
