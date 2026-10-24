import { DEFAULT_BUDGETS, Budget, type Budgets } from "./budget";
import { Judge } from "./judge";
import { ModelCaller } from "./model-call";
import { Tracer, type Stage } from "./trace";
import type { AgentDeps, AttackInput, FamilyStats, Report, StatementInput } from "./types";
import { AttackCancelled, BudgetExceeded } from "../errors";
import { priceTable } from "../models/pricing";

/** Everything one attack shares across its stages. */
export type AttackContext = {
  /** For a StatementInput, `problem` is a placeholder until the understand stage replaces it. */
  input: AttackInput;
  /** Set while a pasted statement still has to be turned into a typed problem. */
  statement?: string;
  deps: AgentDeps;
  limits: Budgets;
  clock: () => number;
  t0: number;
  budget: Budget;
  tracer: Tracer;
  models: ModelCaller;
  judge: Judge;
  report: Report;
  families: FamilyStats[];
  /** Where we are, for error messages. */
  stage: Stage;
  inputsTested: number;
  ttfc: number | null;
  replayKey: string;
  solutionKey: string;
  seed: number;
  /** Aborts in-flight calls when the caller cancels or the wall-clock budget runs out. */
  signal: AbortSignal;
  deadline: AbortSignal;
};

/** Stands in for a pasted statement's problem until the understand stage has typed it. */
function pendingProblem(statement: string): AttackInput["problem"] {
  return { id: "custom", title: "Custom problem", statement, params: [], returns: "", examples: [], compare: "exact", timeLimitMs: 1000, memoryLimitMb: 256 };
}

export function createContext(given: AttackInput | StatementInput, deps: AgentDeps): AttackContext {
  const statement = "statement" in given ? given.statement : undefined;
  const input: AttackInput = "problem" in given ? given : { ...given, problem: pendingProblem(given.statement), solution: { ...given.solution, entry: "" } };
  const clock = deps.clock ?? Date.now;
  const t0 = clock();
  const limits: Budgets = { ...DEFAULT_BUDGETS, ...deps.budgets };
  const budget = new Budget(limits, t0, clock, deps.signal);
  const tracer = new Tracer(t0, clock, deps.onEvent);
  // A real timer, so a hanging network call is cut off even though budget checks use the injectable clock.
  const deadline = AbortSignal.timeout(limits.wallClockMs);
  const signal = deps.signal ? AbortSignal.any([deps.signal, deadline]) : deadline;
  const models = new ModelCaller(deps.provider, deps.models, deps.prices ?? priceTable(), budget, tracer, signal);
  const judge = new Judge(input.problem, deps.executor, budget, tracer, signal);
  const families: FamilyStats[] = [];
  const report: Report = {
    verdict: "error",
    message: "",
    problem: { id: input.problem.id, title: input.problem.title },
    solution: input.solution,
    setup: {
      provider: deps.provider.name,
      executor: deps.executor.label,
      research: deps.research?.name ?? "none",
      routing: deps.models.routing,
      reasoningModel: deps.models.reasoningModel,
      fastModel: deps.models.fastModel,
    },
    families,
    stats: { modelCalls: 0, runs: 0, inputsTested: 0, wallMs: 0, timeToFirstCounterexampleMs: null, costUsd: 0, unpricedCalls: 0, simulatedModelMs: 0 },
    stages: models.stages,
    trace: tracer.events,
  };
  const replayKey = input.replayKey ?? input.problem.id;
  return {
    input,
    statement,
    deps,
    limits,
    clock,
    t0,
    budget,
    tracer,
    models,
    judge,
    report,
    families,
    stage: "understand",
    inputsTested: 0,
    ttfc: null,
    replayKey,
    solutionKey: input.solutionKey ?? replayKey,
    seed: input.seed ?? 1,
    signal,
    deadline,
  };
}

/** Turn an abort into the typed error that explains it (caller cancelled, or wall clock ran out). */
export function explainAbort(ctx: AttackContext, e: unknown): unknown {
  if (ctx.deps.signal?.aborted) return new AttackCancelled("attack cancelled by the caller");
  if (ctx.deadline.aborted) return new BudgetExceeded("wallClock", `${ctx.limits.wallClockMs}ms elapsed during an in-flight call`);
  return e;
}

export function startStage(ctx: AttackContext, stage: Stage, msg: string): void {
  ctx.stage = stage;
  ctx.tracer.emit(stage, "stage_start", msg);
}

/** Fill in final stats and emit the verdict. */
export function finish(ctx: AttackContext): Report {
  const { report, budget, models } = ctx;
  report.stats = {
    modelCalls: budget.modelCalls,
    runs: budget.runs,
    inputsTested: ctx.inputsTested,
    wallMs: ctx.clock() - ctx.t0,
    timeToFirstCounterexampleMs: ctx.ttfc,
    costUsd: models.costUsd,
    unpricedCalls: models.unpricedCalls,
    simulatedModelMs: models.simulatedMs,
  };
  ctx.tracer.emit("report", "result", `Verdict: ${report.verdict}. ${report.message}`, { verdict: report.verdict, stats: report.stats });
  return report;
}
