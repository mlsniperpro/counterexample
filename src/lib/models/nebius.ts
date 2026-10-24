import { z } from "zod";
import { UpstreamError } from "../errors";
import { DEFAULT_RETRY, postJson, type HttpDeps, type RetryPolicy } from "../net/http";
import { DEFAULT_BASE_URL } from "./config";
import type { ModelProvider, ModelRequest, ModelResponse } from "./types";

const chatCompletionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable().optional() }) }))
    .min(1),
  usage: z.object({ prompt_tokens: z.number().int().min(0), completion_tokens: z.number().int().min(0) }).partial().optional(),
});

/** Model calls are slow (long reasoning outputs), so the per-attempt timeout is generous. */
export const NEBIUS_RETRY: RetryPolicy = { ...DEFAULT_RETRY, attempts: 3, timeoutMs: 120_000 };

/** Nebius Token Factory through its OpenAI-compatible chat completions endpoint. */
export class NebiusProvider implements ModelProvider {
  readonly name = "nebius" as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly http: HttpDeps = {},
    private readonly retry: RetryPolicy = NEBIUS_RETRY,
  ) {}

  static fromEnv(env: Record<string, string | undefined> = process.env): NebiusProvider | null {
    if (!env.NEBIUS_API_KEY) return null;
    return new NebiusProvider(env.NEBIUS_API_KEY, env.NEBIUS_BASE_URL || DEFAULT_BASE_URL);
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const t0 = Date.now();
    const raw = await postJson(
      "token-factory",
      `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      { model: req.model, messages: req.messages, max_tokens: req.maxTokens ?? 4096, temperature: req.temperature ?? 0.2 },
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
    const promptTokens = j.usage?.prompt_tokens;
    const completionTokens = j.usage?.completion_tokens;
    return {
      text: j.choices[0]?.message.content ?? "",
      model: j.model ?? req.model,
      promptTokens: promptTokens ?? 0,
      completionTokens: completionTokens ?? 0,
      latencyMs: Date.now() - t0,
      simulated: false,
      // No usage means no price: the caller counts it as unpriced instead of free.
      unmetered: promptTokens === undefined || completionTokens === undefined,
    };
  }
}
