export type ModelRole = "reasoning" | "fast";

export type Purpose = "understand" | "research" | "oracle" | "generators" | "explain";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ModelRequest = {
  model: string;
  purpose: Purpose;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /**
   * Stable key for the deterministic replay provider (a problem id or a
   * solution id). Live providers ignore it.
   */
  replayKey: string;
  /** Attempt number, so a retried call can replay a different response. */
  attempt?: number;
  /** Cancels the call (client gone, or the attack's wall-clock deadline). */
  signal?: AbortSignal;
};

export type ModelResponse = {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  /** True when tokens/latency are estimated (replay), not measured. */
  simulated: boolean;
};

export interface ModelProvider {
  readonly name: "nebius" | "replay" | "recording";
  complete(req: ModelRequest): Promise<ModelResponse>;
}
