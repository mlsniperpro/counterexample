import type { Report } from "@/lib/agent/types";
import { showValue } from "@/lib/core/compare";
import type { SharedReport } from "@/lib/share";

/** Pure formatting helpers shared by the UI components (unit-tested). */

export type ReportNoTrace = Omit<Report, "trace">;

/** One line on how the re-attack of a fix went; only inputs the oracle could judge count as evidence. */
export function fixSummary(f: { verified: boolean; reattackInputs: number; reattackMismatches: number; reattackUnjudged: number }): string {
  const judged = f.reattackInputs - f.reattackUnjudged;
  const unjudged = f.reattackUnjudged ? ` (${f.reattackUnjudged} more the oracle could not judge)` : "";
  if (f.reattackMismatches) return `still fails on ${f.reattackMismatches} of ${judged} judged inputs${unjudged}`;
  if (f.verified) return `re-attacked on ${judged} judged inputs: 0 failures${unjudged}`;
  return `no failure on ${judged} judged inputs${unjudged}, but the re-attack was incomplete`;
}

/** Arguments as text; showValue writes the exact big integers (exactReviver's markers) as plain digits. */
/** The counterexample's heading: an order-dependent failure is not shrunk, and an exhausted shrink may not be minimal. */
export function cxHeading(cx: { shrinkExhausted: boolean; orderDependent?: { precedingInputs: number } }): string {
  if (cx.orderDependent) return `Counterexample (fails only after ${cx.orderDependent.precedingInputs} earlier call(s) in the same process: the solution keeps state between calls)`;
  return cx.shrinkExhausted ? "Counterexample (shrinking stopped early, may not be minimal)" : "Minimal counterexample";
}

export const fmtArgs = (a: unknown[]) => a.map((x) => showValue(x)).join(", ");

/** At most `max` characters of `s`, with "…" marking a cut (never splitting a surrogate pair). */
export function ellipsize(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return `${last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut}…`;
}

/** A duration: whole milliseconds under a second (rounded first, so 999.6 is "1.0 s", never "1000 ms"), else seconds. */
export const ms = (x: number) => (Math.round(x) >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`);

/** Dollars, with more digits for tiny amounts; null means the model had no known price. */
export const usd = (x: number | null) => (x === null ? "unpriced" : `$${x < 0.01 ? x.toFixed(5) : x.toFixed(3)}`);

export const VERDICT: Record<Report["verdict"], string> = {
  counterexample: "Broken: minimal counterexample found",
  no_counterexample: "Survived the attack",
  oracle_unreliable: "Oracle unreliable: no bug claimed",
  compile_error: "Solution does not compile",
  budget_exhausted: "Budget exhausted",
  error: "Error",
};

/** The report as Markdown, for "Copy report". */
export function toMarkdown(r: SharedReport): string {
  const lines = [`# Counterexample report: ${r.problem.title}`, "", `**Verdict:** ${VERDICT[r.verdict]}. ${r.message}`, ""];
  if (r.counterexample) {
    lines.push(`## ${cxHeading(r.counterexample)}`, "", "```", `solve(${fmtArgs(r.counterexample.args)})`, `expected: ${showValue(r.counterexample.expected)}`, `got:      ${r.counterexample.got}`, "```", "");
  }
  if (r.explanation) lines.push("## Why", "", r.explanation, "");
  if (r.fix) lines.push(`## Fix (${r.fix.verified ? "verified" : "NOT verified"}: ${fixSummary(r.fix)})`, "", "```" + r.solution.language, r.fix.code.trim(), "```", "");
  lines.push("## Model routing", "", "| step | model | calls | cost | latency |", "| --- | --- | --- | --- | --- |");
  for (const s of r.stages) lines.push(`| ${s.purpose} | ${s.model}${s.simulated ? " (replay)" : ""} | ${s.calls} | ${usd(s.costUsd)} | ${ms(s.latencyMs)}${s.simulated ? " (simulated)" : ""} |`);
  lines.push("", `${r.stats.inputsTested} inputs, ${r.stats.runs} sandbox runs, ${r.stats.modelCalls} model calls, ${usd(r.stats.costUsd)}. Provider: ${r.setup.provider}; executor: ${r.setup.executor}.`);
  return lines.join("\n");
}
