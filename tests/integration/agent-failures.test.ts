import { describe, expect, it } from "vitest";
import { attack } from "@/lib/agent/run";
import { makeDeps } from "@/lib/agent/setup";
import { UpstreamError } from "@/lib/errors";
import { FIXTURES } from "@/fixtures/replay";
import type { ReplayFixtures } from "@/lib/models/replay";
import { BUILT_INS, getProblem } from "@/lib/problems/catalog";
import type { ResearchClient } from "@/lib/research/tavily";
import type { ModelProvider, ModelRequest } from "@/lib/models/types";
import type { Problem } from "@/lib/problems/types";
import { extractJson } from "@/lib/agent/parse";
import { isCompileFailure } from "@/lib/agent/stages";

const env = { NODE_ENV: "test" };
const builtIn = (id: string) => BUILT_INS.find((b) => b.problem.id === id)!;
const deps = (fixtures?: ReplayFixtures) => makeDeps({ mode: "replay", env, fixtures });

describe("agent failure paths (replay mode)", () => {
  it("keeps going, visibly, when Tavily is down", async () => {
    const down: ResearchClient = { name: "tavily", search: async () => Promise.reject(new UpstreamError("tavily", "HTTP 503: unavailable", 503, true)) };
    const b = builtIn("binary-search");
    const r = await attack({ problem: b.problem, solution: b.demo }, { ...deps(), research: down });
    expect(r.research?.facts).toEqual([]);
    expect(r.verdict).toBe("counterexample");
    expect(r.research?.error).toMatch(/tavily: HTTP 503/);
    expect(r.trace.some((e) => e.kind === "warn" && /Research question failed, continuing/.test(e.msg))).toBe(true);
  });

  it("calls replayed research recorded search results, and a live client Tavily", async () => {
    const b = builtIn("binary-search");
    const replayed = await attack({ problem: b.problem, solution: b.demo, research: "force" }, deps());
    const lines = replayed.trace.filter((e) => e.stage === "research" && (e.kind === "stage_start" || e.kind === "research")).map((e) => e.msg);
    expect(lines[0]).toMatch(/^Researching with recorded search results: /);
    expect(lines.some((m) => /^Recorded search results: ".+" returned \d+ result\(s\)$/.test(m))).toBe(true);
    expect(lines.some((m) => /Tavily/.test(m))).toBe(false);
    // A client that is not the replay one keeps the Tavily wording.
    const replay = deps().research!;
    const live: ResearchClient = { name: "tavily", search: (q, signal) => replay.search(q, signal) };
    const real = await attack({ problem: b.problem, solution: b.demo, research: "force" }, { ...deps(), research: live });
    const realLines = real.trace.filter((e) => e.stage === "research" && (e.kind === "stage_start" || e.kind === "research")).map((e) => e.msg);
    expect(realLines[0]).toMatch(/^Researching with Tavily: /);
    expect(realLines.some((m) => /^Tavily: ".+" returned \d+ result\(s\)$/.test(m))).toBe(true);
  });

  it("says so when research is needed but no client is configured", async () => {
    const b = builtIn("binary-search");
    const r = await attack({ problem: b.problem, solution: b.demo }, { ...deps(), research: null });
    expect(r.research?.error).toMatch(/TAVILY_API_KEY/);
    expect(r.verdict).toBe("counterexample");
  });

  it("drops research facts that cite URLs outside the search results", async () => {
    const fx: ReplayFixtures = { ...FIXTURES, "binary-search": { ...FIXTURES["binary-search"], research: '{"facts":[{"fact":"made up","url":"https://evil.example"}]}' } };
    const b = builtIn("binary-search");
    const r = await attack({ problem: b.problem, solution: b.demo }, deps(fx));
    expect(r.research?.facts).toEqual([]);
    expect(r.trace.some((e) => /not in the search results/.test(e.msg))).toBe(true);
  });

  it("reports rejected generator families and still attacks with examples, mutations and random inputs", async () => {
    const fx: ReplayFixtures = { ...FIXTURES, "coin-change": { ...FIXTURES["coin-change"], generators: '{"families":[{"name":"broken","args":[{"kind":"int","min":9,"max":1}]}]}' } };
    const b = builtIn("coin-change");
    const r = await attack({ problem: b.problem, solution: b.demo }, deps(fx));
    expect(r.trace.some((e) => e.kind === "warn" && /Rejected family broken/.test(e.msg))).toBe(true);
    expect(r.families.map((f) => f.source)).not.toContain("model");
    expect(r.verdict).toBe("counterexample");
  });

  describe("an answer cut at max_tokens", () => {
    /** The replay provider, except that the answer for `purpose` is rewritten by `cut` and reported as cut at 8192 tokens (or as finished). */
    const cutting = (purpose: string, cut: (text: string) => string, finishReason: string | undefined = "length") => {
      const d = deps();
      const provider: ModelProvider = {
        name: d.provider.name,
        complete: async (req: ModelRequest) => {
          const res = await d.provider.complete(req);
          return req.purpose === purpose ? { ...res, text: cut(res.text), ...(finishReason ? { finishReason, maxTokens: 8192 } : {}) } : res;
        },
      };
      return { ...d, provider };
    };
    const b = builtIn("isqrt");
    const run = (d: ReturnType<typeof deps>) => attack({ problem: b.problem, solution: b.demo, research: "off" }, d);
    const halved = (t: string) => t.slice(0, Math.floor(t.length / 2));
    const warnings = (r: Awaited<ReturnType<typeof attack>>) => r.trace.filter((e) => e.kind === "warn").map((e) => e.msg);

    it("stops with the limit named when the oracle's answer is only a cut-off <think> trace", async () => {
      const r = await run(cutting("oracle", () => "<think>The brute force would be"));
      expect(r.verdict).toBe("error");
      expect(r.message).toBe("output was cut at max_tokens (8192) (during oracle)");
    });

    it("says an oracle answer with no code block was cut, when it was", async () => {
      const r = await run(cutting("oracle", (t) => t.slice(0, t.indexOf("```") + 12)));
      expect(r.verdict).toBe("oracle_unreliable");
      expect(warnings(r)).toContain("Oracle answer had no code block on attempt 1 (the answer was cut at max_tokens)");
      // The same answer from a model that simply stopped there is not blamed on the limit.
      const stopped = await run(cutting("oracle", (t) => t.slice(0, t.indexOf("```") + 12), "stop"));
      expect(warnings(stopped)).toContain("Oracle answer had no code block on attempt 1");
    });

    it("adds the note to the generator parse error, and the attack goes on with the built-in families", async () => {
      const r = await run(cutting("generators", halved));
      expect(warnings(r).some((m) => /^The generator answer could not be read \(.* \(the answer was cut at max_tokens\)\)/.test(m))).toBe(true);
      expect(r.verdict).toBe("counterexample");
      const stopped = await run(cutting("generators", halved, "stop"));
      expect(warnings(stopped).some((m) => /cut at max_tokens/.test(m))).toBe(false);
    });

    it("adds the note when the explanation's code block is cut, keeping the counterexample and the explanation", async () => {
      const r = await run(cutting("explain", (t) => t.slice(0, t.indexOf("```") + 20)));
      expect(r.verdict).toBe("counterexample");
      expect(warnings(r).some((m) => /^No fix was proposed \(the answer had no code block\) \(the answer was cut at max_tokens\);/.test(m))).toBe(true);
      expect(r).not.toHaveProperty("fix");
    });
  });

  describe("an unreadable generator answer", () => {
    const isqrt = () => ({ problem: getProblem("isqrt")!, solution: builtIn("isqrt").demo });
    const goodAnswer = [FIXTURES.isqrt?.generators].flat()[0] ?? "";
    const withGenerators = (generators: string): ReplayFixtures => ({ ...FIXTURES, isqrt: { ...FIXTURES.isqrt, generators } });
    const readWarning = (r: Awaited<ReturnType<typeof attack>>) => r.trace.filter((e) => e.kind === "warn" && e.stage === "attack" && /^The generator answer could not be read \(/.test(e.msg));

    it.each([
      ["prose", "Sorry, I can't help with that."],
      ["truncated JSON", goodAnswer.slice(0, 120)],
    ])("attacks with the built-in families only, and says so, when the answer is %s", async (_, answer) => {
      const r = await attack(isqrt(), deps(withGenerators(answer)));
      const [warn] = readWarning(r);
      expect(warn?.msg).toMatch(/\); attacking with the built-in families only$/);
      expect(r.families.map((f) => f.name)).toEqual(["examples", "small-scope", "mutations", "baseline-random"]);
      // The deterministic families still find the int32 overflow, and the fix is still verified.
      expect(r.verdict).toBe("counterexample");
      expect(r.counterexample?.args).toEqual([2147483647]);
      expect(r.counterexample?.original.family).toBe("small-scope");
      expect(r.counterexample?.expected).toBe(46340);
      expect(r.fix?.verified).toBe(true);
    });

    it("reads a valid answer followed by prose that contains a brace", async () => {
      // Unfenced, so the whole text is searched for the object.
      const bare = JSON.stringify(extractJson(goodAnswer));
      const r = await attack(isqrt(), deps(withGenerators(`${bare}\n\nHope this helps! (Use } carefully.)`)));
      expect(readWarning(r)).toEqual([]);
      expect(r.families.map((f) => f.source)).toContain("model");
      expect(r.verdict).toBe("counterexample");
    });

    it("still stops the attack when the budget ends at the generator call", async () => {
      const r = await attack({ ...isqrt(), research: "off" }, { ...deps(), budgets: { maxModelCalls: 1 } });
      expect(r.verdict).toBe("budget_exhausted");
      expect(r.message).toMatch(/modelCalls.*during attack/);
      expect(readWarning(r)).toEqual([]);
    });

    it("still stops the attack when the caller cancels at the generator call", async () => {
      const ac = new AbortController();
      const r = await attack({ ...isqrt(), research: "off" }, { ...deps(), signal: ac.signal, onEvent: (e) => e.stage === "attack" && e.kind === "stage_start" && ac.abort() });
      expect(r.verdict).toBe("error");
      expect(r.message).toMatch(/cancelled.*during attack/);
      expect(readWarning(r)).toEqual([]);
    });
  });

  it("ends the attack during research, with no 'question failed' warning, when the caller cancels", async () => {
    const ac = new AbortController();
    const d = deps();
    // The caller goes away while the search is in flight: the next model call (the summary) sees the cancellation.
    const research: ResearchClient = {
      name: "tavily",
      search: async (q, signal) => {
        ac.abort();
        return d.research!.search(q, signal);
      },
    };
    const b = builtIn("binary-search");
    const r = await attack({ problem: b.problem, solution: b.demo, research: "force" }, { ...d, research, signal: ac.signal });
    expect(r.verdict).toBe("error");
    expect(r.message).toBe("attack cancelled by the caller (during research)");
    expect(r.trace.some((e) => /Research question failed/.test(e.msg))).toBe(false);
    expect(r.stages.some((s) => s.purpose === "oracle")).toBe(false);
  });

  it("uses the code's own function when the model's entry name is not defined, instead of reporting a compile error", async () => {
    const b = builtIn("isqrt");
    const spec = { title: b.problem.title, entry: "squareRoot", params: b.problem.params, returns: b.problem.returns, examples: b.problem.examples, compare: b.problem.compare };
    const fx: ReplayFixtures = { ...FIXTURES, isqrt: { ...FIXTURES.isqrt, understand: "```json\n" + JSON.stringify(spec) + "\n```" } };
    const r = await attack({ statement: b.problem.statement, solution: { language: b.demo.language, code: b.demo.code }, replayKey: "isqrt" }, deps(fx));
    expect(r.solution.entry).toBe("solve");
    expect(r.trace.some((e) => e.kind === "warn" && /named entry "squareRoot", which the code does not define; using "solve" instead/.test(e.msg))).toBe(true);
    expect(r.verdict).toBe("counterexample");
    expect(r.counterexample?.args).toEqual([2147483647]);
  });

  it("shows big-integer example outputs as plain digits in the oracle prompt and in its feedback", async () => {
    const problem: Problem = {
      id: "big-demo",
      title: "Big demo",
      statement: "Return a huge number.",
      params: [{ name: "x", type: { kind: "int", min: 0, max: 10 } }],
      returns: "x",
      examples: [{ args: [1], output: "\u0000int:15999999992000000001" }],
      compare: "exact",
      timeLimitMs: 1000,
      memoryLimitMb: 256,
    };
    const d = deps({ "big-demo": { oracle: "```python\ndef solve(x):\n    return x\n```" } });
    const oraclePrompts: string[] = [];
    const provider: ModelProvider = {
      name: d.provider.name,
      complete: (req: ModelRequest) => {
        if (req.purpose === "oracle") oraclePrompts.push(req.messages.map((m) => m.content).join("\n"));
        return d.provider.complete(req);
      },
    };
    const solution = { language: "python" as const, code: "def solve(x):\n    return x\n", entry: "solve" };
    const r = await attack({ problem, solution, research: "off" }, { ...d, provider });
    expect(r.verdict).toBe("oracle_unreliable");
    expect(oraclePrompts).toHaveLength(3);
    expect(oraclePrompts[0]).toContain("- solve(1) == 15999999992000000001");
    expect(oraclePrompts[1]).toContain("solve(1) returned 1, expected 15999999992000000001");
    for (const prompt of oraclePrompts) expect(prompt).not.toContain("int:");
  });

  it("recognises a solution that does not compile", async () => {
    const r = await attack({ problem: getProblem("isqrt")!, solution: { language: "javascript", code: "function solve(x) { return x +; }", entry: "solve" } }, deps());
    expect(r.verdict).toBe("compile_error");
    expect(r.message).toMatch(/^compile: .*SyntaxError/s);
  });

  it("finds a hanging solution and reports the timeout as the failure", async () => {
    const code = "def solve(nums, target):\n    while target == 0:\n        pass\n    return nums.index(target) if target in nums else -1\n";
    const r = await attack({ problem: getProblem("binary-search")!, solution: { language: "python", code, entry: "solve" }, research: "off" }, deps());
    expect(r.verdict).toBe("counterexample");
    expect(r.counterexample?.got).toMatch(/^timeout/);
    expect(r.counterexample?.args[1]).toBe(0);
  });

  it("cuts off a hanging model call at the wall-clock deadline", async () => {
    const hanging: ModelProvider = {
      name: "nebius",
      complete: (req) => new Promise((_, reject) => req.signal?.addEventListener("abort", () => reject(req.signal!.reason))),
    };
    const t0 = Date.now();
    const b = builtIn("coin-change");
    const r = await attack({ problem: b.problem, solution: b.demo }, { ...deps(), provider: hanging, budgets: { wallClockMs: 200 } });
    expect(r.verdict).toBe("budget_exhausted");
    expect(r.message).toMatch(/wallClock.*during oracle/);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("records every planned family, including those skipped after the first hit", async () => {
    const b = builtIn("isqrt");
    const r = await attack({ problem: b.problem, solution: b.demo }, deps());
    const names = r.families.map((f) => f.name);
    expect(names).toEqual(["examples", "small-scope", "int32-bounds", "tiny", "perfect-squares-neighbourhood", "random-large", "mutations", "baseline-random"]);
    expect(r.families.filter((f) => f.tested > 0).length).toBeLessThan(names.length);
  });

  it("caps every family, small-scope included, at the per-family input budget", async () => {
    const p = getProblem("binary-search")!;
    const { code } = { code: "def solve(nums, target):\n    return nums.index(target) if target in nums else -1\n" };
    const r = await attack({ problem: p, solution: { language: "python", code, entry: "solve" }, research: "off" }, { ...deps(), budgets: { inputsPerFamily: 50 } });
    expect(r.verdict).toBe("no_counterexample");
    for (const f of r.families.filter((x) => x.source !== "examples")) expect(f.tested, f.name).toBeLessThanOrEqual(50);
  });

  it("counts only inputs the oracle could judge as evidence of no bug", async () => {
    const p = getProblem("binary-search")!;
    const oracle = "```python\ndef solve(nums, target):\n    if len(nums) > 6:\n        raise ValueError('too big for me')\n    return nums.index(target) if target in nums else -1\n```";
    const fx: ReplayFixtures = { ...FIXTURES, "binary-search": { ...FIXTURES["binary-search"], oracle } };
    const code = "def solve(nums, target):\n    return nums.index(target) if target in nums else -1\n";
    const r = await attack({ problem: p, solution: { language: "python", code, entry: "solve" }, research: "off" }, deps(fx));
    const skipped = r.families.reduce((n, f) => n + f.oracleSkipped, 0);
    expect(r.verdict).toBe("no_counterexample");
    expect(skipped).toBeGreaterThan(0);
    expect(r.message).toContain(`No mismatch on ${r.stats.inputsTested - skipped} judged inputs`);
    expect(r.message).toContain(`could not judge ${skipped} more`);
  });

  it("only calls it a compile error when every example failed to load", () => {
    const hit = (family: string, got: string) => ({ args: [], family, j: { status: "mismatch" as const, got }, confirmed: true });
    expect(isCompileFailure([hit("examples", "compile: SyntaxError"), hit("examples", "compile: SyntaxError")], 2)).toBe(true);
    expect(isCompileFailure([hit("examples", "compile: SyntaxError")], 2)).toBe(false);
    expect(isCompileFailure([hit("big", "compile: killed"), hit("big", "compile: killed")], 2)).toBe(false);
    expect(isCompileFailure([], 0)).toBe(false);
  });

  it("flags models without a known price instead of guessing a cost", async () => {
    const d = makeDeps({ mode: "replay", env: { ...env, MODEL_FAST: "some/unknown-model" } });
    const b = builtIn("longest-unique-substring");
    const r = await attack({ problem: b.problem, solution: b.demo }, d);
    expect(r.stats.unpricedCalls).toBe(1);
    expect(r.stages.find((s) => s.purpose === "generators")?.costUsd).toBeNull();
    expect(r.trace.some((e) => /some\/unknown-model call reported as unpriced: no price is known/.test(e.msg))).toBe(true);
  });

  it("charges unmetered and failed live calls as unpriced, and a failed generator call costs only the model's families", async () => {
    const b = builtIn("binary-search");
    const replay = deps().provider;
    // A live provider whose first answer (the oracle) has no usage, then fails outright (generators, explain).
    let n = 0;
    const provider = {
      name: "nebius" as const,
      complete: async (req: Parameters<typeof replay.complete>[0]) => {
        if (n++ === 0) return { ...(await replay.complete(req)), simulated: false, unmetered: true };
        throw new UpstreamError("token-factory", "HTTP 503: overloaded", 503, true);
      },
    };
    const r = await attack({ problem: b.problem, solution: b.demo, research: "off" }, { ...deps(), provider });
    expect(r.stats.unpricedCalls).toBe(3);
    expect(r.trace.some((e) => /reported as unpriced: the response reported no token usage/.test(e.msg))).toBe(true);
    // The 503 on the generator call is a warning; the built-in families still find the bug, and the explain failure is reported.
    expect(r.trace.some((e) => e.kind === "warn" && e.msg === "The generator call failed (token-factory: HTTP 503: overloaded); attacking with the built-in families only")).toBe(true);
    expect(r.families.map((f) => f.name)).toEqual(["examples", "small-scope", "mutations", "baseline-random"]);
    expect(r.verdict).toBe("counterexample");
    expect(r.counterexample).toBeDefined();
    expect(r.message).toBe("Found a counterexample, then token-factory: HTTP 503: overloaded (during explain)");
  });

  it("marks a fix as not verified when the run budget ends mid re-attack", async () => {
    const b = builtIn("binary-search");
    const input = { problem: b.problem, solution: b.demo, research: "off" as const };
    // Same budgets except maxRuns, which leaves room for about half of the re-attack.
    const budgets = { maxShrinkEvals: 100 };
    const full = await attack(input, { ...deps(), budgets });
    const r = await attack(input, { ...deps(), budgets: { ...budgets, maxRuns: full.stats.runs - full.fix!.reattackInputs } });
    expect(r.verdict).toBe("counterexample");
    expect(r.fix?.verified).toBe(false);
    expect(r.fix!.reattackInputs).toBeLessThan(full.fix!.reattackInputs);
    expect(r.trace.some((e) => /not verified/.test(e.msg))).toBe(true);
  });
});
