import { showValue } from "../core/compare";
import { SPEC_LIMITS } from "../core/spec";
import type { Problem, Solution } from "../problems/types";
import type { ChatMessage } from "../models/types";
import type { ResearchFact } from "../research/tavily";

const fmtParams = (p: Problem) => p.params.map((x) => `- ${x.name}: ${JSON.stringify(x.type)}`).join("\n");
const fmtExamples = (p: Problem) =>
  p.examples.map((e) => `- solve(${e.args.map((a) => showValue(a)).join(", ")}) == ${showValue(e.output)}`).join("\n");
const fmtFacts = (facts: ResearchFact[]) =>
  facts.length ? `\nResearched facts (cite the URL in "citations" when a family relies on one):\n${facts.map((f) => `- ${f.fact} [${f.url}]`).join("\n")}\n` : "";

const SYSTEM = "You are Counterexample, a meticulous competitive-programming reviewer. Follow the output format exactly.";

export function oraclePrompt(p: Problem, feedback?: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Write a reference solution for this problem that is SLOW BUT OBVIOUSLY CORRECT: brute force, exhaustive search or the most literal reading of the statement. Never optimise; clarity is the only goal. It will be used as an oracle to judge other solutions.

Problem: ${p.title}
${p.statement}

Parameters (input DSL types):
${fmtParams(p)}
Returns: ${p.returns}
Examples:
${fmtExamples(p)}

Answer with one Python 3 code block defining \`def solve(${p.params.map((x) => x.name).join(", ")}):\`. Use only the standard library. Return JSON-serialisable values (lists, not tuples or sets; None for null).${feedback ? `\n\nYour previous oracle was wrong:\n${feedback}\nFix it.` : ""}`,
    },
  ];
}

const DSL_DOC = `Input DSL (JSON):
- {"kind":"int","min":a,"max":b,"bias":"uniform"|"edges"|"small"}   ("edges" favours min, max, 0, +-1)
- {"kind":"array","of":T,"len":{"min":a,"max":b},"sorted":"asc"|"desc","distinct":bool,"pool":k}   (pool=k draws from k values: forces duplicates)
- {"kind":"string","alphabet":"abc","len":{"min":a,"max":b}}
- {"kind":"tuple","items":[T,...],"nondecreasing":bool}
- {"kind":"const","value":v}
- {"kind":"oneOf","options":[T,...]}
- {"kind":"graph","n":{"min":a,"max":b},"m":{"min":a,"max":b},"weight":{"min":a,"max":b},"dag":bool}   (expands to two arguments: n and edges [[u,v,w],...])
Limits: lengths up to ${SPEC_LIMITS.maxLen}, graphs up to ${SPEC_LIMITS.maxNodes} nodes and ${SPEC_LIMITS.maxEdges} edges, nesting up to ${SPEC_LIMITS.maxDepth} levels, at most ${SPEC_LIMITS.maxValuesPerInput} values per input, and a family is cut to the inputs that fit in ${SPEC_LIMITS.maxValuesPerFamily} values in total (so few huge inputs, or many small ones). A graph may only be a top-level argument.`;

export function generatorsPrompt(p: Problem, s: Solution, facts: ResearchFact[]): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Design adversarial input GENERATORS (not individual cases) that are most likely to break this solution. Think about bounds, empty or single-element inputs, duplicates, overflow, worst-case sizes, degenerate graphs and the specific shape of this code.

Problem: ${p.title}
${p.statement}
Parameters (every generated input must also satisfy these, or it is discarded):
${fmtParams(p)}
${fmtFacts(facts)}
Solution under test (${s.language}):
\`\`\`${s.language}
${s.code}
\`\`\`

${DSL_DOC}

Answer with one JSON object: {"families":[{"name":"short-kebab-name","rationale":"one sentence: which bug this targets","count":200,"args":[T for each parameter, in order],"citations":["url", ...]}]}. Give 3 to 6 families, each narrower than the parameter types.`,
    },
  ];
}

export function explainPrompt(
  p: Problem,
  s: Solution,
  args: unknown[],
  expected: unknown,
  got: string,
  feedback?: string,
): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `This solution is wrong. Minimal counterexample: solve(${args.map((a) => showValue(a)).join(", ")}) should return ${showValue(expected)} but returned ${got}.

Problem: ${p.title}
${p.statement}

\`\`\`${s.language}
${s.code}
\`\`\`

Reply as:
EXPLANATION: exactly two sentences naming the root cause, referring to the counterexample.
Then one ${s.language} code block with the complete fixed solution, keeping the function name \`${s.entry}\` and the same approach where possible.${feedback ? `\n\nYour previous fix still failed:\n${feedback}` : ""}`,
    },
  ];
}

export function researchPrompt(p: Problem, results: { title: string; url: string; content: string }[], focus = "official constraints and edge cases"): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Problem: ${p.title}
${p.statement}

Web search results:
${results.map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${r.content.slice(0, 1200)}`).join("\n\n")}

Extract only facts that matter for testing a solution to this problem, about ${focus}. Answer with JSON {"facts":[{"fact":"...","url":"source url"}]}, at most 5 facts, each citing one of the URLs above.`,
    },
  ];
}

export function understandPrompt(statement: string, code: string, language: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Turn this problem statement into a typed spec so inputs can be generated.

Statement:
${statement}

Solution (${language}):
\`\`\`
${code}
\`\`\`

${DSL_DOC}

Answer with JSON {"title":"...","entry":"function name in the solution","params":[{"name":"...","type":T}],"returns":"...","examples":[{"args":[...],"output":...}],"compare":"exact"|"unordered"|"float","references":["external facts the statement depends on, if any"]}. Keep types within the stated constraints but small enough that a brute-force oracle stays fast.`,
    },
  ];
}
