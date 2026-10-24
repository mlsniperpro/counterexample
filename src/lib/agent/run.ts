import { outputsEqual } from "../core/compare";
import { hashString, mulberry32 } from "../core/rng";
import { shrink } from "../core/shrink";
import { argsConform, arity, genArgs, parseTypeSpec, type TypeSpec } from "../core/spec";
import type { Executor, RunOutcome } from "../exec/types";
import { modelFor, type ModelConfig } from "../models/config";
import { costUsd, priceTable } from "../models/pricing";
import type { ChatMessage, ModelProvider, ModelRole, Purpose } from "../models/types";
import type { Problem, Solution } from "../problems/types";
import { needsResearch, type ResearchClient, type ResearchFact } from "../research/tavily";
import { Budget, BudgetExceeded, DEFAULT_BUDGETS, type Budgets } from "./budget";
import { extractCode, extractExplanation, extractJson, stripThinking } from "./parse";
import { explainPrompt, generatorsPrompt, oraclePrompt, researchPrompt } from "./prompts";
import { Tracer, type Stage, type TraceEvent } from "./trace";

export type AttackInput = {
  problem: Problem;
  solution: Solution;
  research?: "auto" | "force" | "off";
  seed?: number;
  /** Replay keys: problem-level fixtures, optionally overridden per solution. */
  replayKey?: string;
  solutionKey?: string;
};

export type AgentDeps = {
  provider: ModelProvider;
  models: ModelConfig;
  executor: Executor;
  research?: ResearchClient | null;
  budgets?: Partial<Budgets>;
  clock?: () => number;
  onEvent?: (e: TraceEvent) => void;
};

export type Family = {
  name: string;
  rationale: string;
  citations: string[];
  args: TypeSpec[];
  count: number;
  source: "examples" | "model" | "baseline";
};

export type FamilyStats = {
  name: string;
  rationale: string;
  citations: string[];
  source: Family["source"];
  generated: number;
  dropped: number;
  tested: number;
  mismatches: number;
  oracleSkipped: number;
};

export type StageCost = {
  stage: Stage;
  purpose: Purpose;
  role: ModelRole;
  model: string;
  why: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  simulated: boolean;
};

export type Verdict =
  | "counterexample"
  | "no_counterexample"
  | "oracle_unreliable"
  | "compile_error"
  | "budget_exhausted"
  | "error";

export type Report = {
  verdict: Verdict;
  message: string;
  problem: { id: string; title: string };
  solution: Solution;
  setup: { provider: string; executor: string; research: string; routing: string; reasoningModel: string; fastModel: string };
  oracle?: { code: string; attempts: number };
  research?: { queries: string[]; facts: ResearchFact[]; influencedFamilies: string[] };
  families: FamilyStats[];
  counterexample?: {
    args: unknown[];
    expected: unknown;
    got: string;
    original: { args: unknown[]; family: string };
    shrinkSteps: number;
    shrinkEvals: number;
  };
  explanation?: string;
  fix?: { code: string; verified: boolean; attempts: number; reattackInputs: number; reattackMismatches: number };
  stats: {
    modelCalls: number;
    runs: number;
    inputsTested: number;
    wallMs: number;
    /** Wall time to the first mismatch plus model latency up to then (simulated in replay mode). */
    timeToFirstCounterexampleMs: number | null;
    costUsd: number;
    simulatedModelMs: number;
  };
  stages: StageCost[];
  trace: TraceEvent[];
};

const WHY: Record<Purpose, string> = {
  understand: "Turning a statement into a typed spec is structured extraction: a fast model is enough.",
  research: "Summarising search results with citations is extraction, not deep reasoning: a fast model is enough.",
  oracle: "A wrong oracle means false alarms, so correctness beats latency: the reasoning model writes it.",
  generators: "Generator families are cheap to try and are checked by the DSL and constraints, so speed wins: a fast model.",
  explain: "Root-causing a bug from one minimal input and writing a fix needs deep reasoning: the reasoning model.",
};

type Verdict1 = { status: "agree" | "mismatch" | "oracle_error"; expected?: unknown; got: string };

const show = (o: RunOutcome): string => (o.ok ? JSON.stringify(o.out) : `${o.error}: ${o.message}`);

const ORACLE_LANGUAGE = "python" as const;

export async function attack(input: AttackInput, deps: AgentDeps): Promise<Report> {
  const clock = deps.clock ?? Date.now;
  const t0 = clock();
  const limits: Budgets = { ...DEFAULT_BUDGETS, ...deps.budgets };
  const budget = new Budget(limits, t0, clock);
  const tracer = new Tracer(t0, clock, deps.onEvent);
  const { problem, solution } = input;
  const replayKey = input.replayKey ?? problem.id;
  const solutionKey = input.solutionKey ?? replayKey;
  const seed = input.seed ?? 1;
  const researchMode = input.research ?? "auto";
  const prices = priceTable();
  const specs = problem.params.map((p) => p.type);

  const stages: StageCost[] = [];
  let costTotal = 0;
  let simulatedMs = 0;
  let inputsTested = 0;
  let ttfc: number | null = null;
  const families: FamilyStats[] = [];

  const report: Report = {
    verdict: "error",
    message: "",
    problem: { id: problem.id, title: problem.title },
    solution,
    setup: {
      provider: deps.provider.name,
      executor: deps.executor.label,
      research: deps.research?.name ?? "none",
      routing: deps.models.routing,
      reasoningModel: deps.models.reasoningModel,
      fastModel: deps.models.fastModel,
    },
    families,
    stats: { modelCalls: 0, runs: 0, inputsTested: 0, wallMs: 0, timeToFirstCounterexampleMs: null, costUsd: 0, simulatedModelMs: 0 },
    stages,
    trace: tracer.events,
  };

  async function callModel(stage: Stage, role: ModelRole, purpose: Purpose, messages: ChatMessage[], key: string, attempt = 0): Promise<string> {
    budget.useModelCall();
    const model = modelFor(deps.models, role);
    const res = await deps.provider.complete({ model, purpose, messages, replayKey: key, attempt });
    const cost = costUsd(res.model, res.promptTokens, res.completionTokens, prices);
    costTotal += cost;
    if (res.simulated) simulatedMs += res.latencyMs;
    const why = deps.models.routing === "ultra-only" ? "Ultra-only baseline: every call goes to the reasoning model." : WHY[purpose];
    let row = stages.find((s) => s.stage === stage && s.purpose === purpose);
    if (!row) {
      row = { stage, purpose, role, model: res.model, why, calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: 0, simulated: res.simulated };
      stages.push(row);
    }
    row.calls++;
    row.promptTokens += res.promptTokens;
    row.completionTokens += res.completionTokens;
    row.costUsd += cost;
    row.latencyMs += res.latencyMs;
    tracer.emit(stage, "model_call", `${purpose} via ${res.model}`, {
      purpose,
      role,
      model: res.model,
      why,
      attempt,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      costUsd: cost,
      latencyMs: res.latencyMs,
      simulated: res.simulated,
    });
    return stripThinking(res.text);
  }

  async function exec(stage: Stage, who: "solution" | "oracle" | "fix", code: string, language: Solution["language"], entry: string, inputs: unknown[][]) {
    budget.useRuns(inputs.length);
    const res = await deps.executor.run({ language, code, entry, inputs, timeLimitMs: problem.timeLimitMs, memoryLimitMb: problem.memoryLimitMb });
    const failed = res.outcomes.filter((o) => !o.ok).length;
    tracer.emit(stage, "exec", `${who}: ${inputs.length} inputs in ${res.wallMs}ms (${res.processes} process${res.processes === 1 ? "" : "es"})`, {
      who,
      inputs: inputs.length,
      errors: failed,
      wallMs: res.wallMs,
      processes: res.processes,
      executor: deps.executor.name,
    });
    return res.outcomes;
  }

  let oracleCode = "";
  async function judge(stage: Stage, target: Solution, inputs: unknown[][], who: "solution" | "fix" = "solution"): Promise<Verdict1[]> {
    if (inputs.length === 0) return [];
    const [sol, ora] = await Promise.all([
      exec(stage, who, target.code, target.language, target.entry, inputs),
      exec(stage, "oracle", oracleCode, ORACLE_LANGUAGE, "solve", inputs),
    ]);
    return inputs.map((_, i) => {
      const o = ora[i];
      const s = sol[i];
      if (!o.ok) return { status: "oracle_error", got: show(s) };
      const agree = s.ok && outputsEqual(s.out, o.out, problem.compare);
      return { status: agree ? "agree" : "mismatch", expected: o.out, got: show(s) };
    });
  }

  function generate(f: Family, salt: string): { inputs: unknown[][]; dropped: number } {
    const rng = mulberry32(hashString(`${seed}:${salt}:${f.name}`));
    const inputs: unknown[][] = [];
    const seen = new Set<string>();
    let dropped = 0;
    for (let i = 0; i < f.count; i++) {
      let args: unknown[];
      try {
        args = genArgs(f.args, rng);
      } catch {
        dropped++;
        continue;
      }
      if (!argsConform(args, specs)) {
        dropped++;
        continue;
      }
      const key = JSON.stringify(args);
      if (seen.has(key)) continue;
      seen.add(key);
      inputs.push(args);
    }
    return { inputs, dropped };
  }

  let stage: Stage = "understand";
  const start = (s: Stage, msg: string) => {
    stage = s;
    tracer.emit(s, "stage_start", msg);
  };

  try {
    // 1. Understand
    start("understand", `Problem "${problem.title}" with ${problem.params.length} typed parameter(s), ${problem.examples.length} example(s)`);
    tracer.emit("understand", "info", `Parameters: ${problem.params.map((p) => `${p.name}: ${p.type.kind}`).join(", ")}`, { params: problem.params });

    // 2. Research (only when the statement leans on external facts)
    let facts: ResearchFact[] = [];
    const queries: string[] = [];
    if (needsResearch(problem.statement, problem.references, researchMode)) {
      start("research", "Statement references external facts: researching with Tavily");
      if (!deps.research) {
        tracer.emit("research", "warn", "Research needed but no research client is configured (set TAVILY_API_KEY); continuing without it");
      } else {
        const qs = problem.references?.length ? problem.references : [`${problem.title} constraints edge cases`];
        const results = [];
        for (const q of qs.slice(0, 2)) {
          queries.push(q);
          const r = await deps.research.search(q);
          results.push(...r);
          tracer.emit("research", "research", `Tavily: "${q}" returned ${r.length} result(s)`, { query: q, urls: r.map((x) => x.url), client: deps.research.name });
        }
        if (results.length) {
          const text = await callModel("research", "fast", "research", researchPrompt(problem, results), replayKey);
          const parsed = extractJson(text) as { facts?: ResearchFact[] };
          const urls = new Set(results.map((r) => r.url));
          facts = (parsed.facts ?? []).filter((f) => typeof f.fact === "string" && urls.has(f.url)).slice(0, 5);
          tracer.emit("research", "research", `${facts.length} cited fact(s) extracted`, { facts });
        }
      }
      report.research = { queries, facts, influencedFamilies: [] };
    }

    // 3. Oracle: brute force from the reasoning model, checked against the examples first
    start("oracle", "Writing a slow but obviously-correct reference solution");
    let feedback: string | undefined;
    let oracleOk = false;
    let attempts = 0;
    for (let a = 0; a < limits.maxOracleAttempts && !oracleOk; a++) {
      attempts++;
      const text = await callModel("oracle", "reasoning", "oracle", oraclePrompt(problem, feedback), replayKey, a);
      oracleCode = extractCode(text, "python");
      const outs = await exec("oracle", "oracle", oracleCode, ORACLE_LANGUAGE, "solve", problem.examples.map((e) => e.args));
      const bad = problem.examples
        .map((e, i) => ({ e, o: outs[i] }))
        .filter(({ e, o }) => !o.ok || !outputsEqual(o.out, e.output, problem.compare));
      if (bad.length === 0) {
        oracleOk = true;
        tracer.emit("oracle", "info", `Oracle matches all ${problem.examples.length} examples (attempt ${a + 1})`);
      } else {
        feedback = bad.map(({ e, o }) => `solve(${e.args.map((x) => JSON.stringify(x)).join(", ")}) returned ${show(o)}, expected ${JSON.stringify(e.output)}`).join("\n");
        tracer.emit("oracle", "warn", `Oracle failed ${bad.length} example(s) on attempt ${a + 1}`, { feedback });
      }
    }
    report.oracle = { code: oracleCode, attempts };
    if (!oracleOk) {
      report.verdict = "oracle_unreliable";
      report.message = "The oracle never matched the examples, so no mismatch could be trusted. No bug is claimed.";
      return finish();
    }

    // 4. Attack: the fast model designs generator families in the input DSL
    start("attack", "Designing adversarial input generators");
    const plan: Family[] = [
      { name: "examples", rationale: "The statement's own examples.", citations: [], args: [], count: problem.examples.length, source: "examples" },
    ];
    const genText = await callModel("attack", "fast", "generators", generatorsPrompt(problem, solution, facts), replayKey);
    const rawFamilies = ((extractJson(genText) as { families?: unknown[] }).families ?? []).slice(0, 8);
    for (const [i, raw] of rawFamilies.entries()) {
      const r = raw as Record<string, unknown>;
      try {
        const args = (r.args as unknown[]).map((x, j) => parseTypeSpec(x, `families[${i}].args[${j}]`));
        const total = args.reduce((n, s) => n + arity(s), 0);
        const want = specs.reduce((n, s) => n + arity(s), 0);
        if (total !== want) throw new Error(`expected ${want} argument(s), got ${total}`);
        const citations = Array.isArray(r.citations) ? r.citations.filter((c): c is string => typeof c === "string") : [];
        plan.push({
          name: String(r.name ?? `family-${i}`),
          rationale: String(r.rationale ?? ""),
          citations,
          args,
          count: Math.min(limits.inputsPerFamily, Math.max(1, Number(r.count) || limits.inputsPerFamily)),
          source: "model",
        });
      } catch (e) {
        tracer.emit("attack", "warn", `Discarded family ${String(r.name ?? i)}: ${(e as Error).message}`);
      }
    }
    plan.push({ name: "baseline-random", rationale: "Uniform random inputs over the declared parameter types.", citations: [], args: specs, count: Math.min(100, limits.inputsPerFamily), source: "baseline" });
    for (const f of plan) {
      tracer.emit("attack", "info", `Family ${f.name}: ${f.rationale}`, { name: f.name, count: f.count, citations: f.citations, source: f.source });
    }
    if (report.research) {
      const factUrls = new Set(report.research.facts.map((f) => f.url));
      report.research.influencedFamilies = plan.filter((f) => f.citations.some((c) => factUrls.has(c))).map((f) => f.name);
      if (report.research.influencedFamilies.length) {
        tracer.emit("attack", "research", `Research shaped ${report.research.influencedFamilies.length} family(ies): ${report.research.influencedFamilies.join(", ")}`, {
          families: report.research.influencedFamilies,
        });
      }
    }

    // 5. Run: solution vs oracle, family by family, stopping at the first family that finds a mismatch
    start("run", `Running the solution and the oracle on generated inputs (${deps.executor.label})`);
    const allInputs: unknown[][] = [];
    let found: { args: unknown[]; v: Verdict1; family: string }[] = [];
    let compileError = false;
    let truncated = false;
    for (const f of plan) {
      const { inputs, dropped } =
        f.source === "examples" ? { inputs: problem.examples.map((e) => e.args), dropped: 0 } : generate(f, "attack");
      const st: FamilyStats = { name: f.name, rationale: f.rationale, citations: f.citations, source: f.source, generated: inputs.length + dropped, dropped, tested: 0, mismatches: 0, oracleSkipped: 0 };
      families.push(st);
      if (dropped) tracer.emit("run", "warn", `${f.name}: dropped ${dropped} input(s) that violate the problem constraints`);
      if (found.length) continue;
      const room = Math.floor(budget.remainingRuns() / 2) - limits.maxShrinkEvals * 2;
      const batch = inputs.slice(0, Math.max(0, room));
      if (batch.length < inputs.length) truncated = true;
      if (batch.length === 0) continue;
      const verdicts = await judge("run", solution, batch);
      allInputs.push(...batch);
      st.tested = batch.length;
      inputsTested += batch.length;
      st.oracleSkipped = verdicts.filter((v) => v.status === "oracle_error").length;
      const hits = verdicts.map((v, i) => ({ args: batch[i], v, family: f.name })).filter((x) => x.v.status === "mismatch");
      st.mismatches = hits.length;
      if (f.source === "examples" && hits.length === batch.length && hits.every((h) => h.v.got.startsWith("compile"))) {
        compileError = true;
        report.message = hits[0].v.got;
        break;
      }
      tracer.emit("run", hits.length ? "counterexample" : "info", `${f.name}: ${batch.length} inputs, ${hits.length} mismatch(es)`, { family: f.name, tested: batch.length, mismatches: hits.length });
      if (hits.length) {
        found = hits;
        ttfc = clock() - t0 + simulatedMs;
      }
    }
    if (compileError) {
      report.verdict = "compile_error";
      return finish();
    }
    if (found.length === 0 && truncated) {
      throw new BudgetExceeded("runs", `only ${inputsTested} inputs fit in ${limits.maxRuns} runs`);
    }
    if (found.length === 0) {
      report.verdict = "no_counterexample";
      report.message = `No mismatch on ${inputsTested} inputs across ${families.filter((f) => f.tested).length} families. That is evidence, not proof.`;
      return finish();
    }

    // 6. Shrink the smallest mismatch to a minimal counterexample
    start("shrink", `Shrinking a counterexample from ${found[0].family} (delta debugging)`);
    found.sort((a, b) => JSON.stringify(a.args).length - JSON.stringify(b.args).length);
    const first = found[0];
    const shrunk = await shrink(first.args, {
      isValid: (a) => argsConform(a, specs),
      stillFails: async (batch) => (await judge("shrink", solution, batch)).map((v) => v.status === "mismatch"),
      maxEvals: limits.maxShrinkEvals,
    });
    const [final] = await judge("shrink", solution, [shrunk.minimal]);
    report.counterexample = {
      args: shrunk.minimal,
      expected: final.expected,
      got: final.got,
      original: { args: first.args, family: first.family },
      shrinkSteps: shrunk.steps,
      shrinkEvals: shrunk.evals,
    };
    tracer.emit("shrink", "counterexample", `Minimal counterexample: solve(${shrunk.minimal.map((a) => JSON.stringify(a)).join(", ")}) expected ${JSON.stringify(final.expected)}, got ${final.got}`, {
      args: shrunk.minimal,
      expected: final.expected,
      got: final.got,
      steps: shrunk.steps,
      evals: shrunk.evals,
    });
    report.verdict = "counterexample";
    report.message = "Found a minimal counterexample.";

    // 7 + 8. Explain, fix, and re-attack the fix before claiming it works
    const reattackInputs = dedupe([shrunk.minimal, first.args, ...allInputs, ...plan.filter((f) => f.source !== "examples").flatMap((f) => generate(f, "reattack").inputs), ...problem.examples.map((e) => e.args)]);
    let fixFeedback: string | undefined;
    for (let a = 0; a < limits.maxFixAttempts; a++) {
      start("explain", a === 0 ? "Explaining the bug and proposing a fix" : "The fix failed: asking for another");
      const text = await callModel("explain", "reasoning", "explain", explainPrompt(problem, solution, shrunk.minimal, final.expected, final.got, fixFeedback), solutionKey, a);
      const explanation = extractExplanation(text);
      const fix: Solution = { language: solution.language, code: extractCode(text, solution.language), entry: solution.entry };
      report.explanation = explanation;
      tracer.emit("explain", "info", explanation, { attempt: a });

      start("reattack", `Re-attacking the fix on ${reattackInputs.length} inputs (all previous families plus a fresh seed)`);
      const room = Math.max(0, Math.floor(budget.remainingRuns() / 2));
      const batch = reattackInputs.slice(0, room);
      const vs = await judge("reattack", fix, batch, "fix");
      const bad = vs.map((v, i) => ({ v, args: batch[i] })).filter((x) => x.v.status === "mismatch");
      report.fix = { code: fix.code, verified: bad.length === 0 && batch.length === reattackInputs.length, attempts: a + 1, reattackInputs: batch.length, reattackMismatches: bad.length };
      tracer.emit("reattack", bad.length ? "warn" : "result", bad.length ? `Fix still fails on ${bad.length} input(s)` : `Fix verified on ${batch.length} inputs`, {
        mismatches: bad.length,
        inputs: batch.length,
      });
      if (bad.length === 0) break;
      const b = bad.sort((x, y) => JSON.stringify(x.args).length - JSON.stringify(y.args).length)[0];
      fixFeedback = `solve(${b.args.map((x) => JSON.stringify(x)).join(", ")}) should return ${JSON.stringify(b.v.expected)} but your fix returned ${b.v.got}.`;
    }
    return finish();
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      report.verdict = report.counterexample ? "counterexample" : "budget_exhausted";
      report.message = `${e.message} during ${stage}`;
      tracer.emit(stage, "warn", report.message);
    } else {
      report.verdict = report.counterexample ? "counterexample" : "error";
      report.message = `${(e as Error).message} (during ${stage})`;
      tracer.emit(stage, "warn", report.message);
    }
    return finish();
  }

  function finish(): Report {
    report.stats = {
      modelCalls: budget.modelCalls,
      runs: budget.runs,
      inputsTested,
      wallMs: clock() - t0,
      timeToFirstCounterexampleMs: ttfc,
      costUsd: costTotal,
      simulatedModelMs: simulatedMs,
    };
    tracer.emit("report", "result", `Verdict: ${report.verdict}. ${report.message}`, { verdict: report.verdict, stats: report.stats });
    return report;
  }
}

function dedupe(xs: unknown[][]): unknown[][] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = JSON.stringify(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
