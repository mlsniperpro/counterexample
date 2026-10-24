export type Budgets = {
  /** Max model calls for the whole attack. */
  maxModelCalls: number;
  /** Max program executions (one solution or oracle on one input counts as one). */
  maxRuns: number;
  /** Wall-clock limit for the whole attack. */
  wallClockMs: number;
  /** Inputs generated per family (the model's "count" is capped to this). */
  inputsPerFamily: number;
  /** Candidate evaluations allowed while shrinking. */
  maxShrinkEvals: number;
  /** Oracle attempts (first try plus retries with feedback). */
  maxOracleAttempts: number;
  /** Fix attempts (each one re-attacked in full). */
  maxFixAttempts: number;
};

export const DEFAULT_BUDGETS: Budgets = {
  maxModelCalls: 12,
  maxRuns: 60_000,
  wallClockMs: 120_000,
  inputsPerFamily: 300,
  maxShrinkEvals: 2_000,
  maxOracleAttempts: 3,
  maxFixAttempts: 2,
};

export class BudgetExceeded extends Error {
  constructor(
    readonly budget: "modelCalls" | "runs" | "wallClock",
    detail: string,
  ) {
    super(`budget exhausted: ${budget} (${detail})`);
  }
}

export class Budget {
  modelCalls = 0;
  runs = 0;
  constructor(
    readonly limits: Budgets,
    private readonly t0: number,
    private readonly clock: () => number,
  ) {}

  elapsed(): number {
    return this.clock() - this.t0;
  }

  checkTime(): void {
    if (this.elapsed() > this.limits.wallClockMs) {
      throw new BudgetExceeded("wallClock", `${this.elapsed()}ms > ${this.limits.wallClockMs}ms`);
    }
  }

  useModelCall(): void {
    this.checkTime();
    if (this.modelCalls + 1 > this.limits.maxModelCalls) {
      throw new BudgetExceeded("modelCalls", `limit ${this.limits.maxModelCalls}`);
    }
    this.modelCalls++;
  }

  /** Reserve n executions, or throw when that would exceed the budget. */
  useRuns(n: number): void {
    this.checkTime();
    if (this.runs + n > this.limits.maxRuns) {
      throw new BudgetExceeded("runs", `${this.runs} + ${n} > ${this.limits.maxRuns}`);
    }
    this.runs += n;
  }

  remainingRuns(): number {
    return this.limits.maxRuns - this.runs;
  }
}
