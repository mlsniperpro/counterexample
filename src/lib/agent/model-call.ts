import { ModelOutputError } from "../errors";
import { modelFor, type ModelConfig } from "../models/config";
import { costUsd, type Price } from "../models/pricing";
import type { ChatMessage, ModelProvider, ModelResponse, ModelRole, Purpose } from "../models/types";
import type { Budget } from "./budget";
import { answerText, stripThinking } from "./parse";
import type { Stage, Tracer } from "./trace";
import type { StageCost } from "./types";

const WHY: Record<Purpose, string> = {
  understand: "Turning a statement into a typed spec is structured extraction: a fast model is enough.",
  research: "Summarising search results with citations is extraction, not deep reasoning: a fast model is enough.",
  oracle: "A wrong oracle means false alarms, so correctness beats latency: the reasoning model writes it.",
  generators: "Generator families are cheap to try and are checked by the DSL and constraints, so speed wins: a fast model.",
  explain: "Root-causing a bug from one minimal input and writing a fix needs deep reasoning: the reasoning model.",
};

/** Appended to a model_call trace line when the answer came from recorded fixtures, not a live call. */
export const REPLAYED_NOTE = " (replayed answer, not a live call)";

/** Appended to a parse error about an answer that the token limit cut short, so the cause is not mistaken for a model that wrote badly. */
export const CUT_NOTE = " (the answer was cut at max_tokens)";

/** `e` with CUT_NOTE appended when it is a parse error (ModelOutputError) about an answer that was `cut`; anything else is returned as it is. */
export function noteCut(e: unknown, cut: boolean): unknown {
  return cut && e instanceof ModelOutputError && !e.message.endsWith(CUT_NOTE) ? new ModelOutputError(e.message + CUT_NOTE, { cause: e }) : e;
}

/** Runs `read` on an answer; a parse error it throws says when the answer was `cut` at the token limit. */
export function readCut<T>(cut: boolean, read: () => T): T {
  try {
    return read();
  } catch (e) {
    throw noteCut(e, cut);
  }
}

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

  /** Like `ask`, for a caller that only needs the text. */
  async call(stage: Stage, role: ModelRole, purpose: Purpose, messages: ChatMessage[], replayKey: string, attempt = 0): Promise<string> {
    return (await this.ask(stage, role, purpose, messages, replayKey, attempt)).text;
  }

  /**
   * One model call: the answer without its reasoning trace, and whether the
   * token limit cut it short (`cut`: the caller should say so if it cannot
   * read the answer, see noteCut). An answer cut so early that nothing but
   * reasoning (or nothing) is left is an error here, since there is nothing to read.
   */
  async ask(stage: Stage, role: ModelRole, purpose: Purpose, messages: ChatMessage[], replayKey: string, attempt = 0): Promise<{ text: string; cut: boolean }> {
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
    // A replayed answer must not read as if the named model really ran.
    const replayed = res.simulated || this.provider.name === "replay";
    this.tracer.emit(stage, "model_call", `${purpose} via ${res.model}${replayed ? REPLAYED_NOTE : ""}`, {
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
    const cut = res.finishReason === "length";
    if (cut && !answerText(res.text)) throw new ModelOutputError(`output was cut at max_tokens (${res.maxTokens ?? res.completionTokens})`);
    return { text: stripThinking(res.text), cut };
  }
}
