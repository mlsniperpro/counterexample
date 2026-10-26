import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { attack } from "@/lib/agent/run";
import { makeDeps } from "@/lib/agent/setup";
import { POST } from "@/app/api/attack/route";
import { getGuard, PUBLIC_BUDGETS, resetGuardForTests } from "@/lib/agent/api";
import { worstCaseAttackUsd } from "@/lib/agent/guard";
import { modelConfigFromEnv } from "@/lib/models/config";
import { priceTable } from "@/lib/models/pricing";
import { preflight } from "@/lib/preflight";
import { BUILT_INS } from "@/lib/problems/catalog";
import { fakeEnv, startFakes, type Fakes } from "../fakes/services";

let fakes: Fakes;
beforeAll(async () => {
  fakes = await startFakes({ rateLimitFirst: 1 });
});
afterAll(async () => fakes.close());

describe("live path over real HTTP (fake Token Factory, Tavily and Judge0)", () => {
  it("preflight passes every check once credentials are set", async () => {
    const checks = await preflight({ ...fakeEnv(fakes), NODE_ENV: "production" });
    expect(checks.filter((c) => c.status !== "pass"), JSON.stringify(checks, null, 2)).toEqual([]);
    expect(checks.map((c) => c.name)).toEqual([
      "config: prices and guards",
      "config: sandbox",
      "token factory: model list",
      "token factory: chat nvidia/Nemotron-3-Ultra-550b-a55b",
      "token factory: chat nvidia/nemotron-3-super-120b-a12b",
      "tavily: search",
      "judge0: languages",
      "judge0: run",
    ]);
  });

  it("preflight names the problem when a model id, a key or a language id is wrong", async () => {
    const env = fakeEnv(fakes);
    const checks = await preflight({ ...env, MODEL_FAST: "nvidia/nemotron-nano-does-not-exist", TAVILY_API_KEY: "wrong", JUDGE0_LANG_PYTHON: "63", NODE_ENV: "production" });
    const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
    expect(byName["token factory: model list"]?.detail).toMatch(/not offered: nvidia\/nemotron-nano-does-not-exist\. Nemotron models offered: nvidia\/Nemotron-3-Ultra/);
    expect(byName["tavily: search"]).toMatchObject({ status: "fail", detail: expect.stringMatching(/HTTP 401/) });
    expect(byName["judge0: languages"]).toMatchObject({ status: "fail", detail: expect.stringMatching(/not Python: set JUDGE0_LANG_PYTHON/) });
  });

  it("runs a full attack through NebiusProvider, TavilyClient and Judge0Executor", async () => {
    const deps = makeDeps({ mode: "live", env: { ...fakeEnv(fakes), NODE_ENV: "production" } });
    expect([deps.provider.name, deps.research?.name, deps.executor.name]).toEqual(["nebius", "tavily", "judge0"]);
    const b = BUILT_INS.find((x) => x.problem.id === "binary-search")!;
    const r = await attack({ problem: b.problem, solution: b.demo }, deps);
    expect(r.verdict).toBe("counterexample");
    expect(r.counterexample?.args).toEqual([[0], 0]);
    expect(r.fix?.verified).toBe(true);
    expect(r.research?.facts.length).toBeGreaterThan(0);
    expect(r.stages.every((s) => !s.simulated && s.costUsd !== null && s.costUsd > 0)).toBe(true);
    expect(r.setup).toMatchObject({ provider: "nebius", research: "tavily", executor: expect.stringMatching(/^Judge0 \(127\.0\.0\.1:\d+\)$/) });
    // The fake rate-limited the first chat call: the client retried it over real HTTP.
    expect(fakes.calls.some((c) => c.path === "/v1/chat/completions" && c.status === 429)).toBe(true);

  });
});

/** Two full attacks, or one under heavy CPU load, can outlast the 60 s default; an overrun must fail on its own terms. */
const ATTACK_TIMEOUT = 180_000;

/** Point the route at the fake services in live mode. Every change is undone by afterEach, even when a test times out or throws. */
function liveEnv(extra: Record<string, string> = {}) {
  for (const [k, v] of Object.entries({ ...fakeEnv(fakes), ...extra })) vi.stubEnv(k, v);
  vi.stubEnv("REPLAY", undefined);
  vi.stubEnv("VERCEL", "1");
  resetGuardForTests();
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetGuardForTests();
});

const isqrt = () => BUILT_INS.find((x) => x.problem.id === "isqrt")!;
const postAttack = (ip: string, body: unknown) =>
  POST(new Request("http://x/api/attack", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify(body) }));
const builtInBody = () => ({ problemId: "isqrt", code: isqrt().demo.code, language: "javascript" });
const readLines = async (res: Response) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l));

describe("POST /api/attack in live mode (fake services)", () => {
  it("streams a live report for a built-in problem, with research", { timeout: ATTACK_TIMEOUT }, async () => {
    liveEnv();
    const res = await postAttack("7.7.7.7", { ...builtInBody(), research: "force" });
    const lines = await readLines(res);
    expect(lines[0]).toMatchObject({ type: "mode", mode: "live", executor: expect.stringMatching(/^Judge0/) });
    const report = lines.at(-1).report;
    expect(report).toMatchObject({ verdict: "counterexample", setup: { provider: "nebius", research: "tavily" } });
    expect(report.counterexample.args).toEqual([2147483647]);
    expect(report.stats.costUsd).toBeGreaterThan(0);
  });

  it("turns a pasted statement into a spec with the fast model, inside the attack's budget", { timeout: ATTACK_TIMEOUT }, async () => {
    liveEnv();
    const custom = await postAttack("7.7.7.8", { statement: isqrt().problem.statement, code: isqrt().demo.code, language: "javascript" });
    const customReport = (await readLines(custom)).at(-1).report;
    expect(customReport.problem).toEqual({ id: "custom", title: "Integer square root" });
    expect(customReport.verdict).toBe("counterexample");
    expect(customReport.counterexample.args).toEqual([2147483647]);
    // The understand call is part of the attack: traced, priced, and counted in its call budget.
    expect(customReport.stages[0]).toMatchObject({ stage: "understand", purpose: "understand" });
    expect(customReport.stats.modelCalls).toBe(customReport.stages.reduce((n: number, s: { calls: number }) => n + s.calls, 0));
    expect(customReport.stats.modelCalls).toBeLessThanOrEqual(PUBLIC_BUDGETS.maxModelCalls);
  });
});

describe("POST /api/attack spend cap (fake Token Factory)", () => {
  it("reserves the worst case at admit, then charges what the attack actually spent", { timeout: ATTACK_TIMEOUT }, async () => {
    liveEnv();
    const models = modelConfigFromEnv(process.env);
    const reserve = worstCaseAttackUsd(PUBLIC_BUDGETS.maxModelCalls, [models.reasoningModel, models.fastModel], priceTable(process.env), 0.05);
    expect(reserve).toBeGreaterThan(0);
    // Room for exactly one attack's reservation: once its real (priced, non-zero) cost is charged, the next one cannot fit.
    vi.stubEnv("DAILY_SPEND_CAP_USD", String(reserve + 1e-9));
    resetGuardForTests();
    const first = await postAttack("7.7.8.1", builtInBody());
    expect(first.status).toBe(200);
    // While it runs, its reservation fills the cap: a concurrent attack is refused.
    expect(getGuard().spentUsd(Date.now())).toBeCloseTo(reserve, 9);
    const concurrent = await postAttack("7.7.8.2", builtInBody());
    expect(concurrent.status).toBe(503);
    const report = (await readLines(first)).at(-1).report;
    expect(report.stats.costUsd).toBeGreaterThan(0);
    // Settled: the reservation is replaced by the actual cost.
    expect(getGuard().spentUsd(Date.now())).toBeCloseTo(report.stats.costUsd, 9);
    expect(getGuard().activeAttacks).toBe(0);
    const next = await postAttack("7.7.8.3", builtInBody());
    expect(next.status).toBe(503);
    expect((await next.json()).error).toMatch(/model budget/);
  });

  it("charges UNPRICED_CALL_USD for every call to a model with no known price, so an unpriced model cannot dodge the cap", { timeout: ATTACK_TIMEOUT }, async () => {
    const UNPRICED = 0.07;
    // "meta/other-model" is served by the fake but has no entry in the price table.
    liveEnv({ MODEL_REASONING: "meta/other-model", MODEL_FAST: "meta/other-model", UNPRICED_CALL_USD: String(UNPRICED) });
    const models = modelConfigFromEnv(process.env);
    const reserve = worstCaseAttackUsd(PUBLIC_BUDGETS.maxModelCalls, [models.reasoningModel, models.fastModel], priceTable(process.env), UNPRICED);
    expect(reserve).toBeCloseTo(PUBLIC_BUDGETS.maxModelCalls * UNPRICED, 9);
    // The cap holds one attack's reservation and nothing more.
    vi.stubEnv("DAILY_SPEND_CAP_USD", String(reserve + 1e-9));
    resetGuardForTests();

    const first = await postAttack("7.7.9.1", builtInBody());
    expect(first.status).toBe(200);
    const report = (await readLines(first)).at(-1).report;
    // Every call was unpriced: no dollars in the report, but calls the guard must count.
    expect(report.stats.costUsd).toBe(0);
    expect(report.stats.unpricedCalls).toBeGreaterThan(0);
    expect(report.stats.unpricedCalls).toBe(report.stats.modelCalls);
    expect(getGuard().activeAttacks).toBe(0);
    expect(getGuard().spentUsd(Date.now())).toBeCloseTo(report.stats.unpricedCalls * UNPRICED, 9);
    // The charge, not the cost, fills the cap: the next live request is refused.
    const next = await postAttack("7.7.9.2", builtInBody());
    expect(next.status).toBe(503);
    expect((await next.json()).error).toMatch(/model budget/);
  });
});

describe("preflight skips what is not configured", () => {
  it("reports an absent sandbox as skip in production, like the judge0 checks, and fails only a configured one that is unusable", async () => {
    const noSandbox: Record<string, string> = { ...fakeEnv(fakes) };
    for (const k of ["JUDGE0_URL", "JUDGE0_TOKEN", "JUDGE0_AUTH"]) delete noSandbox[k];
    const checks = await preflight({ ...noSandbox, NODE_ENV: "production" });
    const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
    expect(byName["config: sandbox"]).toMatchObject({ status: "skip", detail: expect.stringMatching(/JUDGE0_URL not set/) });
    expect(byName["judge0: languages"]?.status).toBe("skip");
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
    // Allowing the local executor makes the sandbox configuration real again.
    const local = await preflight({ ...noSandbox, NODE_ENV: "production", ALLOW_LOCAL_EXECUTOR: "1" });
    expect(local.find((c) => c.name === "config: sandbox")).toMatchObject({ status: "pass" });
    // A configured but unusable sandbox is still a failure, never a skip.
    const bad = await preflight({ ...noSandbox, JUDGE0_URL: "not a url", NODE_ENV: "production" });
    expect(bad.find((c) => c.name === "config: sandbox")?.status).toBe("fail");
  });

  it("asks each model for its default token limit instead of a 16-token cap that would cut a reasoning answer", async () => {
    const sent: { model: string; max_tokens: number }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (String(url).endsWith("/chat/completions")) sent.push(JSON.parse(String(init.body)));
      return fetch(url, init);
    }) as unknown as typeof fetch;
    const env = { ...fakeEnv(fakes), NODE_ENV: "production" };
    await preflight(env, { fetchImpl });
    const models = modelConfigFromEnv(env);
    expect(sent.map((x) => [x.model, x.max_tokens])).toEqual([
      [models.reasoningModel, 16384],
      [models.fastModel, 8192],
    ]);
  });
});
