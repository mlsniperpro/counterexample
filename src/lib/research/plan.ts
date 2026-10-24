import type { Language } from "../exec/types";
import type { Problem, Solution } from "../problems/types";

/**
 * What to research before an attack. Research runs only when the statement
 * cites external sources or the user asks ("Research the web"), as the brief
 * requires. When it runs, it asks two kinds of question:
 * - the problem: its official constraints and edge cases;
 * - the code: the documentation of APIs it calls whose behaviour is a classic
 *   source of bugs (JavaScript's default sort order, 32-bit bitwise
 *   operators, Math.round on halves, Python's round-half-to-even).
 * When research does not run but the code calls such an API, the plan carries
 * a suggestion instead, shown in the trace.
 */
export type ApiRisk = { id: string; api: string; query: string; why: string };
export type ResearchQuery = { query: string; reason: "problem" | "api"; label: string };
export type ResearchPlan = { queries: ResearchQuery[]; reasons: string[]; suggestion?: string };

/** At most this many searches (and fast-model summaries) per attack, to fit the public per-attack model budget. */
export const MAX_QUERIES = 2;

const RULES: Record<Language, { id: string; api: string; re: RegExp; query: string; why: string }[]> = {
  javascript: [
    {
      id: "js-sort-default",
      api: "Array.prototype.sort() without a comparator",
      re: /\.sort\(\s*\)/,
      query: "JavaScript Array.prototype.sort default sort order without compareFn",
      why: "sorts numbers as strings, so 10 comes before 9",
    },
    {
      id: "js-bitwise-32",
      api: "bitwise operators (>>, >>>, <<, |, ~~)",
      // A single | before 0 (not ||), shifts, or double NOT.
      re: />>>?|<<|(?<!\|)\|(?!\|)\s*0\b|~~/,
      query: "JavaScript right shift operator converts operands to 32-bit integers",
      why: "truncate to 32-bit integers, so large values wrap",
    },
    {
      id: "js-math-round",
      api: "Math.round()",
      re: /\bMath\.round\(/,
      query: "JavaScript Math.round fractional part exactly 0.5",
      why: "rounds halves toward +Infinity, and rounding is not flooring",
    },
  ],
  python: [
    {
      id: "py-round-even",
      api: "round()",
      re: /(?<![\w.])round\(/,
      query: "Python built-in round ties to even",
      why: "rounds halves to the even neighbour: round(0.5) == 0, round(2.5) == 2",
    },
  ],
};

/** Code with comments and string literals blanked out, so mentions in them don't count as calls. */
export function codeOnly(code: string, language: Language): string {
  const comment = language === "python" ? /#.*$/gm : /\/\/.*$|\/\*[\s\S]*?\*\//gm;
  return code.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, '""').replace(comment, "");
}

export function detectApiRisks(code: string, language: Language): ApiRisk[] {
  const src = codeOnly(code, language);
  return RULES[language].filter((r) => r.re.test(src)).map(({ id, api, query, why }) => ({ id, api, query, why }));
}

const EXTERNAL = /\b(leetcode|codeforces|atcoder|hackerrank|spoj|usaco|kattis|official|per the docs|documentation|rfc ?\d+|https?:\/\/)/i;

/** Plan the research for one attack: problem questions first, then API-documentation questions, capped. */
export function researchPlan(problem: Problem, solution: Solution, mode: "auto" | "force" | "off"): ResearchPlan {
  const risks = mode === "off" ? [] : detectApiRisks(solution.code, solution.language);
  const cites = (problem.references?.length ?? 0) > 0 || EXTERNAL.test(problem.statement);
  if (mode === "off" || (mode === "auto" && !cites)) {
    const suggestion = risks.length
      ? `The code calls ${risks.map((r) => r.api).join(", ")}, whose documentation lists edge cases (${risks.map((r) => r.why).join("; ")}). Tick "Research the web" to read it and attack those cases.`
      : undefined;
    return { queries: [], reasons: [], ...(suggestion && mode === "auto" ? { suggestion } : {}) };
  }
  const problemQs: ResearchQuery[] = (problem.references?.length ? problem.references : [`${problem.title} constraints edge cases`]).map((q) => ({ query: q, reason: "problem", label: problem.title }));
  const apiQs: ResearchQuery[] = risks.map((r) => ({ query: r.query, reason: "api", label: r.api }));
  // Interleave so a capped plan keeps one problem question and one API question when both exist.
  const queries: ResearchQuery[] = [];
  for (let i = 0; queries.length < MAX_QUERIES && (i < problemQs.length || i < apiQs.length); i++) {
    const a = problemQs[i];
    const b = apiQs[i];
    if (a) queries.push(a);
    if (b && queries.length < MAX_QUERIES) queries.push(b);
  }
  // Reasons describe only the questions actually asked.
  const askedApis = queries.filter((q) => q.reason === "api").map((q) => q.label);
  const reasons = [mode === "force" ? "Research the web was requested" : "the statement cites external sources"];
  if (askedApis.length) reasons.push(`the code calls ${askedApis.join(", ")}, which ${askedApis.length === 1 ? "has" : "have"} documented edge cases`);
  return { queries, reasons };
}
