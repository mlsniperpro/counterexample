import { clipText, displayable, outputsEqual, showValue } from "../core/compare";
import { jsonValues } from "../core/spec";
import { ExecutorError } from "../errors";
import type { Executor, Language, RunOutcome } from "../exec/types";
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

  constructor(
    private readonly problem: Problem,
    private readonly executor: Executor,
    private readonly budget: Budget,
    private readonly tracer: Tracer,
    private readonly signal?: AbortSignal,
  ) {}

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
    for (const batch of byValues(inputs, JUDGE_BATCH_VALUES)) for (const j of await this.compareBatch(stage, target, batch, who)) out.push(j);
    return out;
  }

  private async compareBatch(stage: Stage, target: Solution, inputs: unknown[][], who: "solution" | "fix"): Promise<Judgement[]> {
    if (inputs.length === 0) return [];
    const [sol, ora] = await Promise.all([this.exec(stage, who, target, inputs), this.exec(stage, "oracle", this.oracle(), inputs)]);
    if (sol.length < inputs.length || ora.length < inputs.length) throw new ExecutorError(`executor returned ${sol.length}/${ora.length} outcomes for ${inputs.length} inputs`);
    const out: Judgement[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const o = ora[i] as RunOutcome;
      const s = sol[i] as RunOutcome;
      if (!o.ok) out.push({ status: "oracle_error", got: showOutcome(s) });
      else {
        const agree = s.ok && outputsEqual(s.out, o.out, this.problem.compare);
        out.push({ status: agree ? "agree" : "mismatch", expected: displayable(o.out), got: showOutcome(s) });
      }
      // Comparing and displaying results up to the parse caps costs up to about 0.6 s per chunk: one result per slice.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return out;
  }
}
