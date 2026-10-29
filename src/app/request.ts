/** The /api/attack request body the UI sends (pure, unit-tested against the server's schema). */
export type AttackForm = {
  problemId: string | null;
  statement: string;
  code: string;
  language: "python" | "javascript";
  ultraOnly: boolean;
  /** "Research the web": force the Tavily stage even when the statement cites no external facts. */
  researchWeb: boolean;
};

export function buildAttackBody(f: AttackForm) {
  return {
    ...(f.problemId ? { problemId: f.problemId } : { statement: f.statement }),
    code: f.code,
    language: f.language,
    routing: f.ultraOnly ? ("ultra-only" as const) : ("routed" as const),
    // Unchecked means "auto": research still runs when the statement itself references external facts.
    research: f.researchWeb ? ("force" as const) : ("auto" as const),
  };
}
