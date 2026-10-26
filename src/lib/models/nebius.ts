import { z } from "zod";
import { ModelOutputError, UpstreamError } from "../errors";
import { DEFAULT_RETRY, postJson, type HttpDeps, type RetryPolicy } from "../net/http";
import { DEFAULT_BASE_URL, DEFAULT_REASONING_MODEL, MAX_TOKENS_FAST, MAX_TOKENS_REASONING, modelConfigFromEnv } from "./config";
import type { ModelProvider, ModelRequest, ModelResponse } from "./types";

const chatCompletionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable().optional() }), finish_reason: z.string().nullable().optional() }))
    .min(1),
  usage: z.object({ prompt_tokens: z.number().int().min(0), completion_tokens: z.number().int().min(0) }).partial().optional(),
});

/** Model calls are slow (long reasoning outputs), so the per-attempt timeout is generous. */
const NEBIUS_RETRY: RetryPolicy = { ...DEFAULT_RETRY, attempts: 3, timeoutMs: 120_000 };

/**
 * Nebius Token Factory through its OpenAI-compatible chat completions endpoint.
 *
 * A call without maxTokens gets MAX_TOKENS_REASONING when it targets the
 * reasoning model (hidden reasoning counts against the limit) and
 * MAX_TOKENS_FAST otherwise. With routing "ultra-only" every call targets the
 * reasoning model, so every call gets the larger cap.
 */
export class NebiusProvider implements ModelProvider {
  readonly name = "nebius" as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly http: HttpDeps = {},
    private readonly retry: RetryPolicy = NEBIUS_RETRY,
    private readonly reasoningModel: string = DEFAULT_REASONING_MODEL,
  ) {}

  static fromEnv(env: Record<string, string | undefined> = process.env): NebiusProvider | null {
    if (!env.NEBIUS_API_KEY) return null;
    return new NebiusProvider(env.NEBIUS_API_KEY, env.NEBIUS_BASE_URL || DEFAULT_BASE_URL, {}, NEBIUS_RETRY, modelConfigFromEnv(env).reasoningModel);
  }

  /** The completion-token cap for a call that sets none. */
  maxTokensFor(model: string): number {
    return model.toLowerCase() === this.reasoningModel.toLowerCase() ? MAX_TOKENS_REASONING : MAX_TOKENS_FAST;
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const t0 = Date.now();
    const maxTokens = req.maxTokens ?? this.maxTokensFor(req.model);
    const raw = await postJson(
      "token-factory",
      `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      { model: req.model, messages: req.messages, max_tokens: maxTokens, temperature: req.temperature ?? 0.2 },
      { authorization: `Bearer ${this.apiKey}` },
      this.retry,
      this.http,
      req.signal,
    );
    const parsed = chatCompletionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UpstreamError("token-factory", `unexpected response shape for ${req.model}: ${parsed.error.issues[0]?.message ?? "invalid"}`, null, false);
    }
    const j = parsed.data;
    const choice = j.choices[0];
    const text = choice?.message.content ?? "";
    // A reasoning model can spend the whole limit on hidden reasoning and stop with nothing to show.
    if (choice?.finish_reason === "length" && !text.trim()) {
      throw new ModelOutputError(
        `token-factory: ${req.model} hit the max_tokens limit (${maxTokens}) before it wrote any answer (finish_reason "length"; hidden reasoning counts against the limit). Raise the limit: MAX_TOKENS_REASONING / MAX_TOKENS_FAST in src/lib/models/config.ts, or maxTokens on the call.`,
      );
    }
    const promptTokens = j.usage?.prompt_tokens;
    const completionTokens = j.usage?.completion_tokens;
    return {
      text,
      model: j.model ?? req.model,
      promptTokens: promptTokens ?? 0,
      completionTokens: completionTokens ?? 0,
      latencyMs: Date.now() - t0,
      simulated: false,
      // No usage means no price: the caller counts it as unpriced instead of free.
      unmetered: promptTokens === undefined || completionTokens === undefined,
      ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
      maxTokens,
    };
  }
}
