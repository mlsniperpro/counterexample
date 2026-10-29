import { clipText, type CompareMode, displayable, hasFraction, outputsEqual, showValue } from "../core/compare";
import { jsonValues } from "../core/spec";
import { ExecutorError } from "../errors";
import type { Executor, Language, RunOutcome } from "../exec/types";
import { refusedForTotal } from "../exec/program";
import type { Problem, Solution } from "../problems/types";
import type { Budget } from "./budget";
import type { Stage, Tracer } from "./trace";

const ORACLE_LANGUAGE: Language = "python";

/** `expected` is for display (clipped when huge); comparisons use the full outputs. */
export type Judgement = { status: "agree" | "mismatch" | "oracle_error"; expected?: unknown; got: string };

/** Display text of an outcome, clipped: a solution's output can be megabytes, and it flows into the trace, the report and model prompts. */
export const showOutcome = (o: RunOutcome): string => clipText(o.ok ? showValue(o.out) : `${o.error}: ${o.message}`);

/** Most values sent to the executors in one batch. */
export const JUDGE_BATCH_VALUES = 250_000;

/** Consecutive groups of `inputs`, each within `limit` values (an input over it alone is a group of its own), in order. */
export function byValues(inputs: unknown[][], limit: number): unknown[][][] {
  const groups: unknown[][][] = [];
  let group: unknown[][] = [];
  let values = 0;
  for (const x of inputs) {
    const n = jsonValues(x);
    if (group.length > 0 && values + n > limit) {
      groups.push(group);
      group = [];
      values = 0;
    }
    group.push(x);
    values += n;
  }
  if (group.length > 0) groups.push(group);
  return groups;
}

/** Runs programs in the sandbox (charging the run budget) and compares a target against the oracle. */
export class Judge {
  oracleCode = "";
  /**
   * Most inputs sent in one run since a run's results passed their total budget (Infinity before that): the inputs
   * after the last result read are judged again in fresh runs, and later batches are cut to what fitted, so verbose
   * outputs cost about one run per input instead of a re-run of the rest per result read. It doubles after every
   * batch of that size that fits, so smaller outputs later win back larger batches.
   */
  private perRun = Infinity;

  /**
   * How outputs are compared: the problem's mode, until an exact problem's oracle returns a non-integer number. Then
   * the answers are floats, and a correct approximation (a bisection to 1e-7 against math.sqrt) must not be called a
   * bug, so the rest of the attack compares as floats (integers below 2^50 stay exact) and the trace says so. An
   * integer problem's oracle never returns a fraction, so its comparison stays exact.
   */
  compareMode: CompareMode;

  constructor(
    private readonly problem: Problem,
    private readonly executor: Executor,
    private readonly budget: Budget,
    private readonly tracer: Tracer,
    private readonly signal?: AbortSignal,
  ) {
    this.compareMode = problem.compare;
  }

  async exec(stage: Stage, who: "solution" | "oracle" | "fix", program: Solution, inputs: unknown[][]): Promise<RunOutcome[]> {
    this.budget.useRuns(inputs.length);
    const res = await this.executor.run({
      language: program.language,
      code: program.code,
      entry: program.entry,
      inputs,
      timeLimitMs: this.problem.timeLimitMs,
      memoryLimitMb: this.problem.memoryLimitMb,
      signal: this.signal,
    });
    const errors = res.outcomes.filter((o) => !o.ok).length;
    this.tracer.emit(stage, "exec", `${who}: ${inputs.length} inputs in ${res.wallMs}ms (${res.processes} process${res.processes === 1 ? "" : "es"})`, {
      who,
      inputs: inputs.length,
      errors,
      wallMs: res.wallMs,
      processes: res.processes,
      executor: this.executor.name,
    });
    return res.outcomes;
  }

  oracle(): Solution {
    return { language: ORACLE_LANGUAGE, code: this.oracleCode, entry: "solve" };
  }

  /**
   * Run target and oracle on the same inputs and compare. An oracle failure makes the input unjudgeable, never a
   * mismatch. Inputs are sent in batches of at most JUDGE_BATCH_VALUES values, so no executor call serialises
   * megabytes in one go (16 shrink candidates of 200,000 values each took about a second).
   */
  async compare(stage: Stage, target: Solution, inputs: unknown[][], who: "solution" | "fix" = "solution"): Promise<Judgement[]> {
    const out: Judgement[] = [];
    for (const batch of byValues(inputs, JUDGE_BATCH_VALUES)) {
      for (let at = 0; at < batch.length; ) {
        const piece = batch.slice(at, at + this.perRun);
        at += piece.length;
        for (const j of await this.compareBatch(stage, target, piece, who)) out.push(j);
      }
    }
    return out;
  }

  private async compareBatch(stage: Stage, target: Solution, inputs: unknown[][], who: "solution" | "fix"): Promise<Judgement[]> {
    if (inputs.length === 0) return [];
    const [sol, ora] = await Promise.all([this.exec(stage, who, target, inputs), this.exec(stage, "oracle", this.oracle(), inputs)]);
    if (sol.length < inputs.length || ora.length < inputs.length) throw new ExecutorError(`executor returned ${sol.length}/${ora.length} outcomes for ${inputs.length} inputs`);
    // A result refused only because the run's earlier results used its total budget says nothing about either program:
    // those inputs are judged again in fresh runs, at most as many per run as fitted here (each run reads at least its
    // first result, so this ends; it charges the run budget like any run). Counting them as oracle failures called a
    // correct solution's large outputs unjudgeable.
    const retry = inputs.flatMap((_, i) => (refusedForTotal(sol[i] as RunOutcome) || refusedForTotal(ora[i] as RunOutcome) ? [i] : []));
    // A run always reads its first result, so a refusal there means something else went wrong: no retry, no loop.
    if (retry[0] === 0) retry.length = 0;
    if (retry.length) this.perRun = Math.max(1, retry[0] as number);
    else if (inputs.length >= this.perRun) this.perRun *= 2;
    const again = retry.length ? await this.compare(stage, target, retry.map((i) => inputs[i] as unknown[]), who) : [];
    const retried = new Map(retry.map((i, k) => [i, again[k] as Judgement]));
    if (this.compareMode === "exact" && ora.some((o) => o.ok && hasFraction(o.out))) {
      this.compareMode = "float";
      this.tracer.emit(stage, "warn", "The oracle returns non-integer numbers, so outputs are compared as floats from here on (within 1e-6 relative; integers below 2^50 stay exact)");
    }
    const out: Judgement[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const r = retried.get(i);
      if (r) {
        out.push(r);
        continue;
      }
      const o = ora[i] as RunOutcome;
      const s = sol[i] as RunOutcome;
      if (!o.ok) out.push({ status: "oracle_error", got: showOutcome(s) });
      else {
        const agree = s.ok && outputsEqual(s.out, o.out, this.compareMode);
        out.push({ status: agree ? "agree" : "mismatch", expected: displayable(o.out), got: showOutcome(s) });
      }
      // Comparing and displaying results up to the parse caps costs up to about 0.6 s per chunk: one result per slice.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return out;
  }
}
