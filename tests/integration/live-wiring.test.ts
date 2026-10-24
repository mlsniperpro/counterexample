import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attack } from "@/lib/agent/run";
import { makeDeps } from "@/lib/agent/setup";
import { POST } from "@/app/api/attack/route";
import { resetGuardForTests } from "@/lib/agent/api";
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

describe("POST /api/attack in live mode (fake services)", () => {
  it("streams a live report, including a custom statement turned into a spec by the fast model", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, fakeEnv(fakes));
    delete process.env.REPLAY;
    resetGuardForTests();
    try {
      const isqrt = BUILT_INS.find((x) => x.problem.id === "isqrt")!;
      const res = await POST(
        new Request("http://x/api/attack", {
          method: "POST",
          headers: { "content-type": "application/json", "x-real-ip": "7.7.7.7" },
          body: JSON.stringify({ problemId: "isqrt", code: isqrt.demo.code, language: "javascript", research: "force" }),
        }),
      );
      const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
      expect(lines[0]).toMatchObject({ type: "mode", mode: "live", executor: expect.stringMatching(/^Judge0/) });
      const report = lines.at(-1).report;
      expect(report).toMatchObject({ verdict: "counterexample", setup: { provider: "nebius", research: "tavily" } });
      expect(report.counterexample.args).toEqual([2147483647]);
      expect(report.stats.costUsd).toBeGreaterThan(0);

      // A pasted statement (no problemId): the fast model turns it into a typed spec first.
      const custom = await POST(
        new Request("http://x/api/attack", {
          method: "POST",
          headers: { "content-type": "application/json", "x-real-ip": "7.7.7.8" },
          body: JSON.stringify({ statement: isqrt.problem.statement, code: isqrt.demo.code, language: "javascript" }),
        }),
      );
      const customReport = (await custom.text()).trim().split("\n").map((l) => JSON.parse(l)).at(-1).report;
      expect(customReport.problem).toEqual({ id: "custom", title: "Integer square root" });
      expect(customReport.verdict).toBe("counterexample");
      expect(customReport.counterexample.args).toEqual([2147483647]);
    } finally {
      process.env = saved;
      resetGuardForTests();
    }
  });
});
