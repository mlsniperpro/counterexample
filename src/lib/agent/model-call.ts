import { modelFor, type ModelConfig } from "../models/config";
import { costUsd, type Price } from "../models/pricing";
import type { ChatMessage, ModelProvider, ModelResponse, ModelRole, Purpose } from "../models/types";
import type { Budget } from "./budget";
import { stripThinking } from "./parse";
import type { Stage, Tracer } from "./trace";
import type { StageCost } from "./types";

const WHY: Record<Purpose, string> = {
  understand: "Turning a statement into a typed spec is structured extraction: a fast model is enough.",
  research: "Summarising search results with citations is extraction, not deep reasoning: a fast model is enough.",
  oracle: "A wrong oracle means false alarms, so correctness beats latency: the reasoning model writes it.",
  generators: "Generator families are cheap to try and are checked by the DSL and constraints, so speed wins: a fast model.",
  explain: "Root-causing a bug from one minimal input and writing a fix needs deep reasoning: the reasoning model.",
};

function whyFor(purpose: Purpose, routing: ModelConfig["routing"]): string {
  return routing === "ultra-only" ? "Ultra-only baseline: every call goes to the reasoning model." : WHY[purpose];
}

/** Makes model calls for the agent: charges the budget, routes by role, accounts cost and latency per stage, and traces each call. */
export class ModelCaller {
  readonly stages: StageCost[] = [];
  costUsd = 0;
  unpricedCalls = 0;
  simulatedMs = 0;
  private readonly warnedUnpriced = new Set<string>();

  constructor(
    private readonly provider: ModelProvider,
    private readonly models: ModelConfig,
    private readonly prices: Record<string, Price>,
    private readonly budget: Budget,
    private readonly tracer: Tracer,
    private readonly signal?: AbortSignal,
  ) {}

  async call(stage: Stage, role: ModelRole, purpose: Purpose, messages: ChatMessage[], replayKey: string, attempt = 0): Promise<string> {
    this.budget.useModelCall();
    const model = modelFor(this.models, role);
    let res: ModelResponse;
    try {
      res = await this.provider.complete({ model, purpose, messages, replayKey, attempt, signal: this.signal });
    } catch (e) {
      // A failed or cut-off live call may still be billed: count it as unpriced so the daily spend cap sees it.
      if (this.provider.name !== "replay") this.unpricedCalls++;
      throw e;
    }
    // The echoed model id may differ from the one requested (aliases, casing); fall back to the requested id's price.
    const cost = res.unmetered ? null : (costUsd(res.model, res.promptTokens, res.completionTokens, this.prices) ?? costUsd(model, res.promptTokens, res.completionTokens, this.prices));
    if (cost === null) {
      this.unpricedCalls++;
      const reason = res.unmetered ? "the response reported no token usage" : "no price is known for it (set MODEL_PRICES)";
      if (!this.warnedUnpriced.has(`${res.model}:${reason}`)) {
        this.warnedUnpriced.add(`${res.model}:${reason}`);
        this.tracer.emit(stage, "warn", `${res.model} call reported as unpriced: ${reason}`);
      }
    } else {
      this.costUsd += cost;
    }
    if (res.simulated) this.simulatedMs += res.latencyMs;
    const why = whyFor(purpose, this.models.routing);
    let row = this.stages.find((s) => s.stage === stage && s.purpose === purpose);
    if (!row) {
      row = { stage, purpose, role, model: res.model, why, calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: 0, simulated: res.simulated };
      this.stages.push(row);
    }
    row.calls++;
    row.promptTokens += res.promptTokens;
    row.completionTokens += res.completionTokens;
    row.costUsd = row.costUsd === null || cost === null ? null : row.costUsd + cost;
    row.latencyMs += res.latencyMs;
    this.tracer.emit(stage, "model_call", `${purpose} via ${res.model}`, {
      purpose,
      role,
      model: res.model,
      why,
      attempt,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      costUsd: cost,
      latencyMs: res.latencyMs,
      simulated: res.simulated,
    });
    return stripThinking(res.text);
  }
}
