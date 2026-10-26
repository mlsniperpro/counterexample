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
  /** True when the provider reported no token usage, so the call cannot be priced. */
  unmetered?: boolean;
  /** Why the model stopped, as the provider reports it ("stop", "length" when the answer was cut at the token limit, ...). Absent for replayed answers. */
  finishReason?: string;
  /** The completion-token limit the call ran under (live providers). */
  maxTokens?: number;
};

export interface ModelProvider {
  readonly name: "nebius" | "replay" | "recording";
  complete(req: ModelRequest): Promise<ModelResponse>;
}
