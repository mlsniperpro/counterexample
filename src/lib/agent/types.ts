import type { TypeSpec } from "../core/spec";
import type { Executor } from "../exec/types";
import type { ModelConfig } from "../models/config";
import type { Price } from "../models/pricing";
import type { ModelProvider, ModelRole, Purpose } from "../models/types";
import type { Problem, Solution } from "../problems/types";
import type { ResearchClient, ResearchFact } from "../research/tavily";
import type { Budgets } from "./budget";
import type { Stage, TraceEvent } from "./trace";

export type AttackInput = {
  problem: Problem;
  solution: Solution;
  research?: "auto" | "force" | "off";
  seed?: number;
  /** "baseline-only" skips model-designed and mutation families (ablation for the benchmark). */
  generators?: "model" | "baseline-only";
  /** Replay keys: problem-level fixtures, optionally overridden per solution. */
  replayKey?: string;
  solutionKey?: string;
};

export type AgentDeps = {
  provider: ModelProvider;
  models: ModelConfig;
  executor: Executor;
  research?: ResearchClient | null;
  budgets?: Partial<Budgets>;
  clock?: () => number;
  onEvent?: (e: TraceEvent) => void;
  /** Price table (from makeDeps, validated at startup); defaults to priceTable(). */
  prices?: Record<string, Price>;
  /** Abort to stop the attack at its next model call or sandbox run. */
  signal?: AbortSignal;
};

export type FamilySource = "examples" | "exhaustive" | "model" | "mutation" | "baseline";

export type Family = {
  name: string;
  rationale: string;
  citations: string[];
  args: TypeSpec[];
  count: number;
  source: FamilySource;
};

export type FamilyStats = {
  name: string;
  rationale: string;
  citations: string[];
  source: FamilySource;
  generated: number;
  dropped: number;
  tested: number;
  mismatches: number;
  oracleSkipped: number;
};

export type StageCost = {
  stage: Stage;
  purpose: Purpose;
  role: ModelRole;
  model: string;
  why: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  /** null when the model has no known price. */
  costUsd: number | null;
  latencyMs: number;
  simulated: boolean;
};

export type Verdict = "counterexample" | "no_counterexample" | "oracle_unreliable" | "compile_error" | "budget_exhausted" | "error";

export type Counterexample = {
  args: unknown[];
  /** The oracle's answer; absent when the oracle could not judge the minimal input. */
  expected?: unknown;
  got: string;
  original: { args: unknown[]; family: string };
  shrinkSteps: number;
  shrinkEvals: number;
};

export type Report = {
  verdict: Verdict;
  message: string;
  problem: { id: string; title: string };
  solution: Solution;
  setup: { provider: string; executor: string; research: string; routing: string; reasoningModel: string; fastModel: string };
  oracle?: { code: string; attempts: number };
  research?: { queries: string[]; facts: ResearchFact[]; influencedFamilies: string[]; error?: string };
  families: FamilyStats[];
  counterexample?: Counterexample;
  explanation?: string;
  fix?: { code: string; verified: boolean; attempts: number; reattackInputs: number; reattackMismatches: number };
  stats: {
    modelCalls: number;
    runs: number;
    inputsTested: number;
    wallMs: number;
    /** Wall time to the first mismatch plus model latency up to then (simulated in replay mode). */
    timeToFirstCounterexampleMs: number | null;
    /** Sum over priced calls; see unpricedCalls. */
    costUsd: number;
    unpricedCalls: number;
    simulatedModelMs: number;
  };
  stages: StageCost[];
  trace: TraceEvent[];
};
