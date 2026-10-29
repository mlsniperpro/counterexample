import { BUILT_INS } from "@/lib/problems/catalog";
import type { UIProblem } from "./attack-ui";

/** What the page shows for each built-in: its statement and examples from the problem, its language and code from the demo. */
export function uiProblems(builtIns: typeof BUILT_INS = BUILT_INS): UIProblem[] {
  return builtIns.map((b) => ({
    id: b.problem.id,
    title: b.problem.title,
    statement: b.problem.statement,
    examples: b.problem.examples,
    language: b.demo.language,
    code: b.demo.code,
  }));
}
