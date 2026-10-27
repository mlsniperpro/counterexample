import { createHash } from "node:crypto";
import { z } from "zod";
import { clipText, outputsEqual, showValue } from "../core/compare";
import { shrink } from "../core/shrink";
import { smallScope, smallScopeInputs } from "../core/smallscope";
import { argsConform, type TypeSpec } from "../core/spec";
import { AppError, AttackCancelled, BudgetExceeded, errorMessage, ModelOutputError, UpstreamError } from "../errors";
import type { Solution } from "../problems/types";
import { researchPlan } from "../research/plan";
import type { ResearchFact } from "../research/tavily";
import { startStage, type AttackContext } from "./context";
import { generateInputs, mutationInputs, parseFamilies, type Generated } from "./families";
import { Judge, showOutcome, type Judgement } from "./judge";
import { CUT_NOTE, readCut } from "./model-call";
import { extractCode, extractExplanation, parseJsonAnswer } from "./parse";
import { explainPrompt, generatorsPrompt, oraclePrompt, researchPrompt, understandPrompt } from "./prompts";
import type { Counterexample, Family, FamilyStats } from "./types";
import { parseUnderstanding } from "./understand";

/** Inputs per sandbox batch in the run stage: small enough to stop early on a hit or a hang. */
export const RUN_CHUNK = 64;
const MUTANTS = 300;
const SMALL_SCOPE = 300;
const BASELINE = 100;
const BASELINE_ONLY = 1000;
/** Hits re-checked (smallest first) when confirming a mismatch before shrinking. */
export const CONFIRM_HITS = 4;

const specsOf = (ctx: AttackContext) => ctx.input.problem.params.map((p) => p.type);
/** A call as display text for trace messages, clipped (an unshrunk input can be megabytes; the event's data keeps the full value). */
const call = (args: unknown[]) => `solve(${clipText(args.map((a) => showValue(a)).join(", "))})`;

/**
 * For a pasted statement, the fast model types it first (one traced, budgeted
 * call); then the problem's parameters are announced.
 */
export async function understandStage(ctx: AttackContext): Promise<void> {
  if (ctx.statement !== undefined) {
    startStage(ctx, "understand", "Turning the pasted statement into a typed spec");
    const { solution } = ctx.input;
    const { text, cut } = await ctx.models.ask("understand", "fast", "understand", understandPrompt(ctx.statement, solution.code, solution.language), ctx.replayKey);
    const statement = ctx.statement;
    const { problem, entry, note } = readCut(cut, () => parseUnderstanding(text, statement, solution));
    if (note) ctx.tracer.emit("understand", "warn", note);
    ctx.input = { ...ctx.input, problem, solution: { ...solution, entry } };
    ctx.judge = new Judge(problem, ctx.deps.executor, ctx.budget, ctx.tracer, ctx.signal);
    ctx.report.problem = { id: problem.id, title: problem.title };
    ctx.report.solution = ctx.input.solution;
    ctx.statement = undefined;
  }
  const { problem } = ctx.input;
  startStage(ctx, "understand", `Problem "${problem.title}" with ${problem.params.length} typed parameter(s), ${problem.examples.length} example(s)`);
  ctx.tracer.emit("understand", "info", `Parameters: ${problem.params.map((p) => `${p.name}: ${p.type.kind}`).join(", ")}`, { params: problem.params });
}

const factsSchema = z.object({ facts: z.array(z.object({ fact: z.string().min(1).max(500), url: z.string() })).max(10) });

/**
 * Tavily research, only when the statement leans on external facts. A failed
 * search is reported in the trace and the report (never hidden) and the attack
 * continues without research; a budget overrun or a cancellation still stops
 * the attack.
 */
export async function researchStage(ctx: AttackContext): Promise<ResearchFact[]> {
  const { problem, solution } = ctx.input;
  const plan = researchPlan(problem, solution, ctx.input.research ?? "auto");
  if (plan.suggestion) ctx.tracer.emit("understand", "info", plan.suggestion, { suggestion: "research" });
  if (plan.queries.length === 0) return [];
  const client = ctx.deps.research;
  // Replay mode serves recorded results; the trace must not say a live search ran.
  const source = client?.name === "replay" ? "recorded search results" : "Tavily";
  startStage(ctx, "research", `Researching with ${source}: ${plan.reasons.join("; ")}`);
  const research: NonNullable<typeof ctx.report.research> = { queries: plan.queries.map((q) => q.query), facts: [], influencedFamilies: [] };
  ctx.report.research = research;
  if (!client) {
    research.error = "no research client configured (set TAVILY_API_KEY)";
    ctx.tracer.emit("research", "warn", `Research needed but skipped: ${research.error}`);
    return [];
  }
  // One search and one fast-model summary per question, so every fact cites a page from its own search.
  // A failed question is reported and skipped; the others still run.
  const errors: string[] = [];
  for (const q of plan.queries) {
    try {
      const r = await client.search(q.query, ctx.signal);
      ctx.tracer.emit("research", "research", `${source === "Tavily" ? "Tavily: " : "Recorded search results: "}"${q.query}" returned ${r.results.length} result(s)`, { query: q.query, reason: q.reason, urls: r.results.map((x) => x.url), client: client.name });
      if (r.dropped) ctx.tracer.emit("research", "warn", `Dropped ${r.dropped} malformed search result(s) (non-http(s) URL or wrong shape)`);
      if (r.results.length === 0) continue;
      const focus = q.reason === "api" ? `the documented behaviour of ${q.label} that can make a solution wrong` : "official constraints and edge cases";
      const { text, cut } = await ctx.models.ask("research", "fast", "research", researchPrompt(problem, r.results, focus), `${ctx.replayKey}?q=${q.query}`);
      const urls = new Set(r.results.map((x) => x.url));
      const answer = readCut(cut, () => parseJsonAnswer(text, factsSchema, "research facts"));
      const uncited = answer.facts.filter((f) => !urls.has(f.url)).length;
      if (uncited) ctx.tracer.emit("research", "warn", `Dropped ${uncited} fact(s) citing a URL that was not in the search results`);
      research.facts.push(...answer.facts.filter((f) => urls.has(f.url)).slice(0, 5));
    } catch (e) {
      if (e instanceof BudgetExceeded || e instanceof AttackCancelled || !(e instanceof AppError)) throw e;
      errors.push(`"${q.query}": ${errorMessage(e)}`);
      ctx.tracer.emit("research", "warn", `Research question failed, continuing: "${q.query}": ${errorMessage(e)}`);
    }
  }
  if (errors.length) research.error = errors.join("; ");
  ctx.tracer.emit("research", "research", `${research.facts.length} cited fact(s) extracted`, { facts: research.facts });
  return research.facts;
}

/** The reasoning model writes a brute-force oracle; it must match every example before it is trusted. */
export async function oracleStage(ctx: AttackContext): Promise<boolean> {
  const { problem } = ctx.input;
  startStage(ctx, "oracle", "Writing a slow but obviously-correct reference solution");
  let feedback: string | undefined;
  for (let a = 0; a < ctx.limits.maxOracleAttempts; a++) {
    ctx.report.oracle = { code: ctx.judge.oracleCode, attempts: a + 1 };
    const { text, cut } = await ctx.models.ask("oracle", "reasoning", "oracle", oraclePrompt(problem, feedback), ctx.replayKey, a);
    try {
      ctx.judge.oracleCode = extractCode(text, "python");
    } catch (e) {
      // A prose-only answer is a failed attempt, not a failed attack: retry with feedback while attempts remain.
      if (!(e instanceof ModelOutputError)) throw e;
      feedback = "Your answer had no fenced ```python code block. Reply with the complete oracle in one python code block.";
      ctx.tracer.emit("oracle", "warn", `Oracle answer had no code block on attempt ${a + 1}${cut ? CUT_NOTE : ""}`);
      continue;
    }
    ctx.report.oracle.code = ctx.judge.oracleCode;
    const outs = await ctx.judge.exec("oracle", "oracle", ctx.judge.oracle(), problem.examples.map((e) => e.args));
    const bad = problem.examples.flatMap((e, i) => {
      const o = outs[i];
      return o && o.ok && outputsEqual(o.out, e.output, problem.compare) ? [] : [`${call(e.args)} returned ${o ? showOutcome(o) : "nothing"}, expected ${showValue(e.output)}`];
    });
    if (bad.length === 0) {
      ctx.tracer.emit("oracle", "info", `Oracle matches all ${problem.examples.length} examples (attempt ${a + 1})`);
      return true;
    }
    feedback = bad.join("\n");
    ctx.tracer.emit("oracle", "warn", `Oracle failed ${bad.length} example(s) on attempt ${a + 1}`, { feedback });
  }
  ctx.report.verdict = "oracle_unreliable";
  ctx.report.message = "The oracle never matched the examples, so no mismatch could be trusted. No bug is claimed.";
  return false;
}

/** A count of combinations for display: exact while it is small, else in scientific notation. */
const showCount = (n: number) => (n < 1e9 ? String(n) : n.toExponential(1).replace("e+", " x 10^"));

/**
 * The small-scope family. Honest about a cut: when the small inputs outnumber
 * the cap it says how many it kept and that they were sampled evenly. When the
 * space of combinations is too big to enumerate, only a stride sample of it
 * was looked at, and the text says that instead of claiming a count; when
 * nothing small fits the declared types the family says it is empty.
 */
function smallScopeFamily(ctx: AttackContext, specs: TypeSpec[]): Family {
  const cap = Math.min(SMALL_SCOPE, ctx.limits.inputsPerFamily);
  const { inputs, total, capped, space, standIn } = smallScope(specs, cap);
  const why = "bounded exhaustive testing: most bugs have a small counterexample";
  const cut = inputs.length < total;
  let rationale: string;
  if (inputs.length === 0) {
    rationale = `No small input of the declared types exists (for example, every graph is larger than the small scope), so this family is empty (${why}).`;
    ctx.tracer.emit("attack", "warn", "small-scope: no small input fits the declared types; the family is empty", { kept: 0, space });
  } else if (capped) {
    // Too many combinations to enumerate: the kept inputs are a stride sample across all of them.
    rationale = `${inputs.length} of ${showCount(space)} combinations of small values of the declared types, sampled evenly across all of them (${why}).`;
    ctx.tracer.emit("attack", "info", `small-scope: ${inputs.length} kept of ${showCount(space)} combinations of small values, sampled by stride across all of them (the combinations are decoded from their index, so the sample is not a prefix)`, { kept: inputs.length, space, capped });
  } else if (cut) {
    rationale = `${inputs.length} of ${total} small inputs of the declared types, sampled evenly (${why}).`;
    ctx.tracer.emit("attack", "info", `small-scope: ${inputs.length} of ${total} small inputs kept, sampled evenly across the enumeration (every ${(total / inputs.length).toFixed(1)}th), not a prefix`, { kept: inputs.length, total, capped });
  } else {
    rationale = `Every small input of the declared types (${why}).`;
  }
  if (standIn && inputs.length) {
    rationale += " A graph with no small instance is held at its smallest valid graph.";
    ctx.tracer.emit("attack", "info", "small-scope: a graph parameter has no small instance, so its smallest valid graph stands in while the other parameters vary");
  }
  return { name: "small-scope", rationale, citations: [], args: specs, count: cap, source: "exhaustive" };
}

/** The fast model's generator families, validated, with citations limited to this run's research. */
async function modelFamiliesFor(ctx: AttackContext, facts: ResearchFact[]): Promise<Family[]> {
  const { problem, solution } = ctx.input;
  const { text, cut } = await ctx.models.ask("attack", "fast", "generators", generatorsPrompt(problem, solution, facts), ctx.replayKey);
  const { families, rejected } = readCut(cut, () => parseFamilies(text, specsOf(ctx), ctx.limits.inputsPerFamily));
  for (const r of rejected) ctx.tracer.emit("attack", "warn", `Rejected family ${r.name}: ${r.reason}`);
  // A family may only cite sources this run's research actually gave the model.
  const given = new Set(facts.map((f) => f.url));
  let uncited = 0;
  for (const f of families) {
    const kept = f.citations.filter((c) => given.has(c));
    uncited += f.citations.length - kept.length;
    f.citations = kept;
  }
  if (uncited) ctx.tracer.emit("attack", "info", `Removed ${uncited} citation(s) to sources that were not part of this run's research`);
  return families;
}

/** The fast model designs generator families; examples first, mutations and a random baseline after. */
export async function attackStage(ctx: AttackContext, facts: ResearchFact[]): Promise<Family[]> {
  const { problem } = ctx.input;
  const specs = specsOf(ctx);
  startStage(ctx, "attack", "Designing adversarial input generators");
  const baselineOnly = ctx.input.generators === "baseline-only";
  const modelFamilies = (ctx.input.generators ?? "model") === "model";
  const plan: Family[] = [{ name: "examples", rationale: "The statement's own examples.", citations: [], args: [], count: problem.examples.length, source: "examples" }];
  if (!baselineOnly) {
    plan.push(smallScopeFamily(ctx, specs));
    if (modelFamilies) {
      try {
        plan.push(...(await modelFamiliesFor(ctx, facts)));
      } catch (e) {
        // An unreadable or failed generator call costs only the model's families; the deterministic ones still attack.
        if (e instanceof ModelOutputError) ctx.tracer.emit("attack", "warn", `The generator answer could not be read (${errorMessage(e)}); attacking with the built-in families only`);
        else if (e instanceof UpstreamError) ctx.tracer.emit("attack", "warn", `The generator call failed (${errorMessage(e)}); attacking with the built-in families only`);
        else throw e;
      }
    }
    plan.push({ name: "mutations", rationale: "Type-aware mutants of the examples and of earlier inputs (EvalPlus-style).", citations: [], args: specs, count: Math.min(MUTANTS, ctx.limits.inputsPerFamily), source: "mutation" });
  }
  plan.push({
    name: "baseline-random",
    rationale: "Uniform random inputs over the declared parameter types.",
    citations: [],
    args: specs,
    count: baselineOnly ? BASELINE_ONLY : Math.min(BASELINE, ctx.limits.inputsPerFamily),
    source: "baseline",
  });
  for (const f of plan) ctx.tracer.emit("attack", "info", `Family ${f.name}: ${f.rationale}`, { name: f.name, count: f.count, citations: f.citations, source: f.source });
  const research = ctx.report.research;
  if (research) {
    const factUrls = new Set(research.facts.map((f) => f.url));
    research.influencedFamilies = plan.filter((f) => f.citations.some((c) => factUrls.has(c))).map((f) => f.name);
    if (research.influencedFamilies.length) {
      ctx.tracer.emit("attack", "research", `Research shaped ${research.influencedFamilies.length} family(ies): ${research.influencedFamilies.join(", ")}`, {
        families: research.influencedFamilies,
      });
    }
  }
  return plan;
}

/**
 * `confirmed`: the mismatch reproduced on a fresh re-run. `orderDependent`: it
 * reproduced only after `precedingInputs` earlier inputs ran in the same
 * process; `sequence` is those inputs and then this one, in the order they ran.
 */
type Hit = { args: unknown[]; j: Judgement; family: string; confirmed: boolean; orderDependent?: { precedingInputs: number; sequence: unknown[][] } };

/** Smallest serialised arguments first. Each item is measured once, not twice per comparison (22 inputs of 200,000 values took 4 s). */
function smallestFirst<T extends { args: unknown[] }>(xs: T[]): T[] {
  return xs
    .map((x) => ({ x, n: JSON.stringify(x.args).length }))
    .sort((a, b) => a.n - b.n)
    .map((e) => e.x);
}

/** Let the event loop run (other requests, the deadline timer) between slices of synchronous work. */
const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Re-judge new hits on a fresh run before trusting them, smallest first, in
 * batches of CONFIRM_HITS until one batch has a hit that fails again: a
 * sandbox can time out or crash for reasons that are not the solution's
 * (load, a shared time budget), and a bug must reproduce before it is
 * claimed. Each checked hit runs in its own process, so state an earlier call
 * left behind cannot make a passing input look wrong. Returns the confirmed
 * hits (with their fresh judgement) followed by the not yet re-checked rest,
 * or nothing when no hit reproduced (the run then goes on).
 *
 * When no hit fails alone, `chunk` (the inputs the hits were found in) is run
 * once more in the original order in one process. Hits that fail again there
 * are deterministic, not flaky: the solution keeps state between calls. The
 * smallest of them is returned alone, marked `orderDependent`.
 */
export async function confirmHits(ctx: AttackContext, found: Hit[], chunk?: unknown[][]): Promise<Hit[]> {
  const sorted = smallestFirst(found);
  const dropped: unknown[][] = [];
  let result: Hit[] = [];
  for (let at = 0; at < sorted.length && !result.length; at += CONFIRM_HITS) {
    const confirmed: Hit[] = [];
    for (const h of sorted.slice(at, at + CONFIRM_HITS)) {
      const [j] = await ctx.judge.compare("run", ctx.input.solution, [h.args]);
      if (j && j.status === "mismatch") confirmed.push({ ...h, j, confirmed: true });
      else dropped.push(h.args);
    }
    if (confirmed.length) result = [...confirmed, ...sorted.slice(at + CONFIRM_HITS)];
  }
  if (!result.length && chunk && dropped.length) {
    const ordered = await orderDependentHit(ctx, sorted, chunk);
    if (ordered) {
      ctx.tracer.emit("run", "info", `${dropped.length} mismatch(es) pass when run alone but fail again in the original order: the solution keeps state between calls, so the failure is deterministic`, {
        inputs: dropped.slice(0, 10),
        precedingInputs: ordered.orderDependent?.precedingInputs,
      });
      return [ordered];
    }
  }
  if (dropped.length) {
    ctx.droppedMismatches += dropped.length;
    ctx.tracer.emit("run", "warn", `${dropped.length} mismatch(es) did not reproduce on a re-run (flaky execution, e.g. an overloaded sandbox) and were dropped`, {
      inputs: dropped.slice(0, 10),
    });
  }
  return result;
}

/** Re-runs `chunk` in order in one process; the smallest hit that fails again, after at least one earlier input (with the inputs it took to fail), or undefined. */
async function orderDependentHit(ctx: AttackContext, sorted: Hit[], chunk: unknown[][]): Promise<Hit | undefined> {
  const again = await ctx.judge.compare("run", ctx.input.solution, chunk);
  for (const h of sorted) {
    const at = chunk.indexOf(h.args);
    const j = again[at];
    if (at > 0 && j && j.status === "mismatch") return { ...h, j, confirmed: true, orderDependent: { precedingInputs: at, sequence: chunk.slice(0, at + 1) } };
  }
  return undefined;
}

function inputsFor(ctx: AttackContext, f: Family, tested: unknown[][], salt: string): Generated {
  // Generation is synchronous: check the deadline between families.
  ctx.signal.throwIfAborted();
  const specs = specsOf(ctx);
  switch (f.source) {
    case "examples":
      return { inputs: ctx.input.problem.examples.map((e) => e.args), dropped: 0 };
    case "mutation":
      return mutationInputs(tested, specs, f.count, ctx.seed, salt);
    case "exhaustive":
      // Deterministic: the same small inputs on attack and re-attack.
      return { inputs: smallScopeInputs(specs, f.count), dropped: 0 };
    default:
      return generateInputs(f, specs, ctx.seed, salt);
  }
}

/**
 * Solution vs oracle, family by family in chunks, stopping at the first
 * chunk with a mismatch. Returns the hits and every input tested.
 */
export async function runStage(ctx: AttackContext, plan: Family[]): Promise<{ hits: Hit[]; tested: unknown[][] }> {
  const { solution } = ctx.input;
  startStage(ctx, "run", `Running the solution and the oracle on generated inputs (${ctx.deps.executor.label})`);
  const tested: unknown[][] = [];
  let hits: Hit[] = [];
  let truncated = false;
  for (const f of plan) {
    if (hits.length) {
      // Recorded so the report shows the whole plan; these families still feed the re-attack of a fix.
      ctx.families.push({ name: f.name, rationale: f.rationale, citations: f.citations, source: f.source, generated: 0, dropped: 0, tested: 0, mismatches: 0, oracleSkipped: 0 });
      continue;
    }
    const { inputs, dropped } = inputsFor(ctx, f, tested, "attack");
    const st: FamilyStats = { name: f.name, rationale: f.rationale, citations: f.citations, source: f.source, generated: inputs.length + dropped, dropped, tested: 0, mismatches: 0, oracleSkipped: 0 };
    ctx.families.push(st);
    if (dropped) ctx.tracer.emit("run", "warn", `${f.name}: dropped ${dropped} input(s) that violate the problem constraints`);
    // Room is in inputs (two runs each); shrinking needs maxShrinkEvals inputs, plus the confirm and final re-checks.
    const room = Math.max(0, Math.floor(ctx.budget.remainingRuns() / 2) - ctx.limits.maxShrinkEvals - CONFIRM_HITS - 1);
    const batch = inputs.slice(0, room);
    if (batch.length < inputs.length) truncated = true;
    for (let at = 0; at < batch.length && !hits.length; at += RUN_CHUNK) {
      const chunk = batch.slice(at, at + RUN_CHUNK);
      const judged = await ctx.judge.compare("run", solution, chunk);
      tested.push(...chunk);
      st.tested += chunk.length;
      ctx.inputsTested += chunk.length;
      st.oracleSkipped += judged.filter((j) => j.status === "oracle_error").length;
      const found = judged.flatMap((j, i) => (j.status === "mismatch" ? [{ args: chunk[i] as unknown[], j, family: f.name, confirmed: false }] : []));
      if (!found.length) continue;
      const kept = await confirmHits(ctx, found, chunk);
      st.mismatches += kept.length;
      if (kept.length) {
        hits = kept;
        ctx.ttfc = ctx.clock() - ctx.t0 + ctx.models.simulatedMs;
      }
    }
    ctx.tracer.emit("run", st.mismatches ? "counterexample" : "info", `${f.name}: ${st.tested} inputs, ${st.mismatches} mismatch(es)`, {
      family: f.name,
      tested: st.tested,
      mismatches: st.mismatches,
      oracleSkipped: st.oracleSkipped,
    });
  }
  if (!hits.length && truncated) throw new BudgetExceeded("runs", `only ${ctx.inputsTested} inputs fit in ${ctx.limits.maxRuns} runs`);
  return { hits, tested };
}

/**
 * True when the solution never loaded (syntax error, missing entry function).
 * Judged on the examples family only: the examples run first, so a solution
 * that does not load fails all of them the same way there.
 */
export function isCompileFailure(hits: Hit[], examples: number): boolean {
  return examples > 0 && hits.length === examples && hits.every((h) => h.family === "examples" && h.j.got.startsWith("compile:"));
}

/**
 * Delta-debug the smallest confirmed hit down to a minimal counterexample.
 * The confirmed, unshrunk hit is recorded first, so a budget or cancellation
 * during shrinking still keeps a real counterexample.
 */
export async function shrinkStage(ctx: AttackContext, hits: Hit[]): Promise<Counterexample> {
  const first = smallestFirst(hits.filter((h) => h.confirmed))[0];
  if (!first) throw new Error("shrinkStage needs at least one confirmed hit");
  const original = { args: first.args, family: first.family };
  if (first.orderDependent) return keepOrderDependent(ctx, first, first.orderDependent, original);
  startStage(ctx, "shrink", `Shrinking a counterexample from ${first.family} (delta debugging)`);
  ctx.report.counterexample = { args: first.args, expected: first.j.expected, got: first.j.got, original, shrinkSteps: 0, shrinkEvals: 0, shrinkExhausted: true };
  ctx.report.verdict = "counterexample";
  ctx.report.message = "Found a counterexample (not yet shrunk).";
  const specs = specsOf(ctx);
  const shrunk = await shrink(first.args, {
    isValid: (a) => argsConform(a, specs),
    stillFails: async (batch) => (await ctx.judge.compare("shrink", ctx.input.solution, batch)).map((j) => j.status === "mismatch"),
    maxEvals: ctx.limits.maxShrinkEvals,
    signal: ctx.signal,
    // Small batches: only the first still-failing candidate matters, and each hanging candidate costs a full time limit.
    batchSize: 16,
  });
  // Re-judge the result to report expected vs got for it; if it does not fail again, keep the confirmed original.
  const [final] = shrunk.steps ? await ctx.judge.compare("shrink", ctx.input.solution, [shrunk.minimal]) : [first.j];
  const reproduced = final?.status === "mismatch";
  if (!reproduced) ctx.tracer.emit("shrink", "warn", "The shrunk input did not fail again on a re-run; reporting the confirmed original input instead");
  const cx: Counterexample = {
    args: reproduced ? shrunk.minimal : first.args,
    expected: reproduced ? final.expected : first.j.expected,
    got: reproduced ? final.got : first.j.got,
    original,
    shrinkSteps: reproduced ? shrunk.steps : 0,
    shrinkEvals: shrunk.evals,
    shrinkExhausted: shrunk.exhausted || !reproduced,
  };
  ctx.report.counterexample = cx;
  // "Exhausted" also covers a result that did not fail again; the wording says which of the two happened.
  ctx.report.message = !reproduced
    ? "Found a counterexample. The shrunk input did not fail again, so the confirmed original is shown and it may not be minimal."
    : cx.shrinkExhausted
      ? "Found a counterexample. Shrinking stopped early, so it may not be minimal."
      : "Found a minimal counterexample.";
  const label = !reproduced
    ? "Counterexample (the shrunk input did not fail again; the confirmed original is shown)"
    : cx.shrinkExhausted
      ? "Counterexample (shrink budget exhausted, may not be minimal)"
      : "Minimal counterexample";
  ctx.tracer.emit("shrink", "counterexample", `${label}: ${call(cx.args)} expected ${clipText(showValue(cx.expected))}, got ${cx.got}`, {
    args: cx.args,
    expected: cx.expected,
    got: cx.got,
    steps: cx.shrinkSteps,
    evals: cx.shrinkEvals,
    exhausted: cx.shrinkExhausted,
  });
  return cx;
}

/** An order-dependent hit is reported as found: shrinking runs candidates alone, which would lose the condition that makes it fail. */
function keepOrderDependent(ctx: AttackContext, hit: Hit, order: NonNullable<Hit["orderDependent"]>, original: Counterexample["original"]): Counterexample {
  startStage(ctx, "shrink", `Not shrinking the counterexample from ${hit.family}: it fails only after earlier calls in the same process`);
  const cx: Counterexample = { args: hit.args, expected: hit.j.expected, got: hit.j.got, original, shrinkSteps: 0, shrinkEvals: 0, shrinkExhausted: true, orderDependent: order };
  ctx.report.counterexample = cx;
  ctx.report.verdict = "counterexample";
  ctx.report.message = "The solution fails on this input only after earlier calls in the same process: it keeps state between calls. Run alone, it is correct.";
  ctx.tracer.emit("shrink", "counterexample", `Counterexample (order-dependent, not shrunk): ${call(cx.args)} expected ${clipText(showValue(cx.expected))}, got ${cx.got}. It fails only after ${order.precedingInputs} earlier input(s) in the same process: the solution keeps state between calls. Run alone, it is correct.`, {
    args: cx.args,
    expected: cx.expected,
    got: cx.got,
    orderDependent: { precedingInputs: order.precedingInputs },
  });
  return cx;
}

/** The reasoning model explains and fixes; every fix is re-attacked on all earlier inputs plus a fresh seed before it is called verified. */
export async function fixStage(ctx: AttackContext, cx: Counterexample, plan: Family[], tested: unknown[][]): Promise<void> {
  const { problem, solution } = ctx.input;
  // Regenerating every family is seconds of synchronous work for large inputs: let the event loop run between families.
  const fresh: unknown[][] = [];
  for (const f of plan) {
    if (f.source === "examples") continue;
    for (const x of inputsFor(ctx, f, tested, "reattack").inputs) fresh.push(x);
    await breathe();
  }
  const others = [cx.args, cx.original.args, ...tested, ...fresh, ...problem.examples.map((e) => e.args)];
  // An order-dependent counterexample passes run alone, even on the buggy code: the fix is first run on the exact
  // sequence that made it fail (repeats included), in one chunk and in order, and the counterexample is judged at its place in it.
  const sequence = cx.orderDependent?.sequence ?? [];
  const unordered = cx.orderDependent !== undefined && sequence.length === 0;
  const inSequence = new Set(sequence.map((x) => JSON.stringify(x)));
  const reattack = [...sequence, ...(await dedupe(others)).filter((x) => !inSequence.has(JSON.stringify(x)))];
  const cxAt = Math.max(0, sequence.length - 1);
  let feedback: string | undefined;
  for (let a = 0; a < ctx.limits.maxFixAttempts; a++) {
    startStage(ctx, "explain", a === 0 ? "Explaining the bug and proposing a fix" : "The fix failed: asking for another");
    const { text, cut } = await ctx.models.ask("explain", "reasoning", "explain", explainPrompt(problem, solution, cx.args, cx.expected, cx.got, feedback, cx.orderDependent !== undefined), ctx.solutionKey, a);
    ctx.report.explanation = extractExplanation(text);
    ctx.tracer.emit("explain", "info", ctx.report.explanation, { attempt: a });
    let fix: Solution;
    try {
      fix = { language: solution.language, code: extractCode(text, solution.language), entry: solution.entry };
    } catch (e) {
      if (!(e instanceof ModelOutputError)) throw e;
      // An explanation without code is still useful; there is just nothing to re-attack.
      // A fix left over from an earlier attempt belongs to the earlier explanation: the report keeps one coherent attempt.
      delete ctx.report.fix;
      ctx.tracer.emit("explain", "warn", `No fix was proposed (the answer had no code block)${cut ? CUT_NOTE : ""}; the counterexample and explanation stand on their own`);
      return;
    }

    // Recorded before the re-attack, so a budget or clock overrun during it still keeps the fix and what was checked of it.
    const record = { code: fix.code, verified: false, attempts: a + 1, reattackInputs: 0, reattackMismatches: 0, reattackUnjudged: 0 };
    ctx.report.fix = record;
    startStage(ctx, "reattack", `Re-attacking the fix on ${reattack.length} inputs (all previous families plus a fresh seed)`);
    const batch = reattack.slice(0, Math.max(0, Math.floor(ctx.budget.remainingRuns() / 2)));
    // In chunks, counterexample first (an order-dependent one: its sequence first): a fix that fails early stops paying for the rest, and every chunk is kept in the report.
    let bad: { j: Judgement; args: unknown[] }[] = [];
    let cxFixed = false;
    for (let at = 0; at < batch.length && !bad.length; ) {
      const first = at === 0;
      const chunk = batch.slice(at, at + (first && sequence.length ? sequence.length : RUN_CHUNK));
      at += chunk.length;
      const judged = await ctx.judge.compare("reattack", fix, chunk, "fix");
      // Only inputs the oracle could judge are evidence, and the counterexample itself (first, or last of its sequence) must be one of them.
      if (first) cxFixed = !unordered && judged[cxAt]?.status === "agree";
      bad = judged.flatMap((j, i) => (j.status === "mismatch" ? [{ j, args: chunk[i] as unknown[] }] : []));
      record.reattackInputs += chunk.length;
      record.reattackMismatches += bad.length;
      record.reattackUnjudged += judged.filter((j) => j.status === "oracle_error").length;
    }
    const checked = record.reattackInputs;
    const unjudged = record.reattackUnjudged;
    const verified = bad.length === 0 && checked === reattack.length && cxFixed;
    record.verified = verified;
    const unjudgedNote = unjudged ? ` (the oracle could not judge ${unjudged} more, which prove nothing)` : "";
    if (bad.length === 0 && !verified) {
      const why = checked < reattack.length ? `the run budget ran out after ${checked} of ${reattack.length} inputs` : unordered ? "the order in which the counterexample failed was not recorded" : "the oracle could not judge the counterexample itself";
      ctx.tracer.emit("reattack", "warn", `Fix had no mismatch on ${checked - unjudged} judged inputs${unjudgedNote}, but ${why}, so it is not verified`);
      return;
    }
    ctx.tracer.emit("reattack", bad.length ? "warn" : "result", bad.length ? `Fix still fails on ${bad.length} input(s)` : `Fix verified on ${checked - unjudged} judged inputs${unjudgedNote}`, {
      mismatches: bad.length,
      inputs: checked,
      unjudged,
    });
    if (verified) return;
    const worst = smallestFirst(bad)[0];
    if (worst) feedback = `${call(worst.args)} should return ${clipText(showValue(worst.j.expected))} but your fix returned ${worst.j.got}.`;
  }
}

/** Characters serialised between yields while deduplicating. */
const DEDUPE_SLICE = 1_000_000;

/** First occurrences only, in order. Keyed by a digest (the inputs can be megabytes), yielding to the event loop as it goes. */
async function dedupe(xs: unknown[][]): Promise<unknown[][]> {
  const seen = new Set<string>();
  const out: unknown[][] = [];
  let since = 0;
  for (const x of xs) {
    const text = JSON.stringify(x);
    since += text.length;
    const k = createHash("sha1").update(text).digest("base64");
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
    if (since >= DEDUPE_SLICE) {
      since = 0;
      await breathe();
    }
  }
  return out;
}
