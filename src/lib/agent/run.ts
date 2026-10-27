import { BudgetExceeded, errorMessage } from "../errors";
import { createContext, explainAbort, finish } from "./context";
import { attackStage, fixStage, isCompileFailure, oracleStage, researchStage, runStage, shrinkStage, understandStage } from "./stages";
import type { AgentDeps, AttackInput, Report, StatementInput } from "./types";

export type { AgentDeps, AttackInput, Report, StatementInput } from "./types";

/**
 * One attack on one solution: understand, research (if needed), oracle,
 * attack, run, shrink, explain + fix, re-attack, report. Every stage is
 * budgeted and traced. Never throws: failures become a verdict, and a
 * counterexample found before a failure is kept.
 */
export async function attack(input: AttackInput | StatementInput, deps: AgentDeps): Promise<Report> {
  const ctx = createContext(input, deps);
  const { report } = ctx;
  for (const w of deps.warnings ?? []) ctx.tracer.emit("understand", "warn", w);
  try {
    await understandStage(ctx);
    const facts = await researchStage(ctx);
    if (!(await oracleStage(ctx))) return finish(ctx);
    const plan = await attackStage(ctx, facts);
    const { hits, tested } = await runStage(ctx, plan);
    if (isCompileFailure(hits, ctx.input.problem.examples.length)) {
      report.verdict = "compile_error";
      report.message = hits[0]?.j.got ?? "the solution did not load";
      return finish(ctx);
    }
    if (hits.length === 0) {
      // Only inputs the oracle could judge count as evidence.
      const skipped = ctx.families.reduce((n, f) => n + f.oracleSkipped, 0);
      const judged = ctx.inputsTested - skipped;
      if (skipped > judged) {
        // An oracle that fails or times out on most inputs (an exponential brute force, say) leaves too little evidence
        // to say the solution survived.
        report.verdict = "oracle_unreliable";
        report.message = `The oracle could not judge ${skipped} of ${ctx.inputsTested} inputs (it failed or timed out on them), so there is no verdict: no mismatch on the ${judged} it judged.`;
        return finish(ctx);
      }
      report.verdict = "no_counterexample";
      const unjudged = skipped ? ` The oracle could not judge ${skipped} more (it failed or timed out on them), so those prove nothing.` : "";
      const dropped = ctx.droppedMismatches ? ` ${ctx.droppedMismatches} mismatch(es) did not reproduce on a re-run and were dropped.` : "";
      report.message = `No mismatch on ${judged} judged inputs across ${ctx.families.filter((f) => f.tested).length} families.${unjudged}${dropped} That is evidence, not proof.`;
      return finish(ctx);
    }
    const cx = await shrinkStage(ctx, hits);
    await fixStage(ctx, cx, plan, tested);
  } catch (caught) {
    const e = explainAbort(ctx, caught);
    const kept = report.counterexample !== undefined;
    report.verdict = kept ? "counterexample" : e instanceof BudgetExceeded ? "budget_exhausted" : "error";
    // A fix recorded before its re-attack finished is kept, but it is not a verified one.
    const unverified = ctx.stage === "reattack" && report.fix !== undefined && !report.fix.verified ? `. The proposed fix was not verified${e instanceof BudgetExceeded ? " in time" : ""}` : "";
    report.message = `${kept ? "Found a counterexample, then " : ""}${errorMessage(e)} (during ${ctx.stage})${unverified}`;
    ctx.tracer.emit(ctx.stage, "warn", report.message, { error: e instanceof Error ? e.name : "unknown" });
  }
  return finish(ctx);
}
