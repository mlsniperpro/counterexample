import { outputsEqual } from "../core/compare";
import { ExecutorError } from "../errors";
import type { Executor, Language, RunOutcome } from "../exec/types";
import type { Problem, Solution } from "../problems/types";
import type { Budget } from "./budget";
import type { Stage, Tracer } from "./trace";

export const ORACLE_LANGUAGE: Language = "python";

export type Judgement = { status: "agree" | "mismatch" | "oracle_error"; expected?: unknown; got: string };

export const showOutcome = (o: RunOutcome): string => (o.ok ? JSON.stringify(o.out) : `${o.error}: ${o.message}`);

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

  /** Run target and oracle on the same inputs and compare. An oracle failure makes the input unjudgeable, never a mismatch. */
  async compare(stage: Stage, target: Solution, inputs: unknown[][], who: "solution" | "fix" = "solution"): Promise<Judgement[]> {
    if (inputs.length === 0) return [];
    const [sol, ora] = await Promise.all([this.exec(stage, who, target, inputs), this.exec(stage, "oracle", this.oracle(), inputs)]);
    return inputs.map((_, i) => {
      const o = ora[i];
      const s = sol[i];
      if (!o || !s) throw new ExecutorError(`executor returned ${sol.length}/${ora.length} outcomes for ${inputs.length} inputs`);
      if (!o.ok) return { status: "oracle_error", got: showOutcome(s) };
      const agree = s.ok && outputsEqual(s.out, o.out, this.problem.compare);
      return { status: agree ? "agree" : "mismatch", expected: o.out, got: showOutcome(s) };
    });
  }
}
