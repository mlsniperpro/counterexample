import type { ReportNoTrace } from "@/app/format";

/** A complete report as /api/attack sends it (no trace), with every optional section present. Override fields per test. */
export function fullReport(over: Partial<ReportNoTrace> = {}): ReportNoTrace {
  return {
    verdict: "counterexample",
    message: "Found a minimal counterexample.",
    problem: { id: "binary-search", title: "Binary search" },
    solution: { language: "python", code: "def solve(a, t):\n    return -1\n", entry: "solve" },
    setup: { provider: "replay", executor: "Local", research: "none", routing: "routed", reasoningModel: "u", fastModel: "s" },
    research: { queries: ["q"], facts: [{ fact: "A fact.", url: "https://example.com/doc" }], influencedFamilies: ["single-element"] },
    families: [{ name: "single-element", rationale: "One element.", citations: [], source: "model", generated: 5, dropped: 0, tested: 5, mismatches: 1, oracleSkipped: 0 }],
    counterexample: { args: [[0], 0], expected: 0, got: "-1", original: { args: [[3, 1, 2], 1], family: "single-element" }, shrinkSteps: 3, shrinkEvals: 9, shrinkExhausted: false },
    explanation: "Because the loop stops early.",
    fix: { code: "def solve(a, t):\n    return 0\n", verified: true, attempts: 1, reattackInputs: 10, reattackMismatches: 0, reattackUnjudged: 0 },
    stats: { modelCalls: 2, runs: 5, inputsTested: 3, wallMs: 1, timeToFirstCounterexampleMs: 1, costUsd: 0.001, unpricedCalls: 0, simulatedModelMs: 0 },
    stages: [{ stage: "oracle", purpose: "oracle", role: "reasoning", model: "nvidia/u", why: "w", calls: 1, promptTokens: 1, completionTokens: 1, costUsd: null, latencyMs: 10, simulated: true }],
    ...over,
  };
}

export const traceEvent = (seq: number) => ({ seq, t: seq, stage: "run", kind: "info", msg: `e${seq}` });

/** One NDJSON line. */
export const line = (m: unknown) => JSON.stringify(m) + "\n";
