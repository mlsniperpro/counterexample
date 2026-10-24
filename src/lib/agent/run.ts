import { BudgetExceeded, errorMessage } from "../errors";
import { createContext, explainAbort, finish } from "./context";
import { attackStage, fixStage, isCompileFailure, oracleStage, researchStage, runStage, shrinkStage, understandStage } from "./stages";
import type { AgentDeps, AttackInput, Report } from "./types";

export type { AgentDeps, AttackInput, Report } from "./types";

/**
 * One attack on one solution: understand, research (if needed), oracle,
 * attack, run, shrink, explain + fix, re-attack, report. Every stage is
 * budgeted and traced. Never throws: failures become a verdict, and a
 * counterexample found before a failure is kept.
 */
export async function attack(input: AttackInput, deps: AgentDeps): Promise<Report> {
  const ctx = createContext(input, deps);
  const { report } = ctx;
  try {
    understandStage(ctx);
    const facts = await researchStage(ctx);
    if (!(await oracleStage(ctx))) return finish(ctx);
    const plan = await attackStage(ctx, facts);
    const { hits, tested } = await runStage(ctx, plan);
    if (isCompileFailure(hits, input.problem.examples.length)) {
      report.verdict = "compile_error";
      report.message = hits[0]?.j.got ?? "the solution did not load";
      return finish(ctx);
    }
    if (hits.length === 0) {
      report.verdict = "no_counterexample";
      report.message = `No mismatch on ${ctx.inputsTested} inputs across ${ctx.families.filter((f) => f.tested).length} families. That is evidence, not proof.`;
      return finish(ctx);
    }
    const cx = await shrinkStage(ctx, hits);
    await fixStage(ctx, cx, plan, tested);
  } catch (caught) {
    const e = explainAbort(ctx, caught);
    const kept = report.counterexample !== undefined;
    report.verdict = kept ? "counterexample" : e instanceof BudgetExceeded ? "budget_exhausted" : "error";
    report.message = `${kept ? "Found a minimal counterexample, then " : ""}${errorMessage(e)} (during ${ctx.stage})`;
    ctx.tracer.emit(ctx.stage, "warn", report.message, { error: e instanceof Error ? e.name : "unknown" });
  }
  return finish(ctx);
}
