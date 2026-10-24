import { DEFAULT_BASE_URL } from "./config";
import type { ModelProvider, ModelRequest, ModelResponse } from "./types";

type ChatCompletion = {
  choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
};

/** Nebius Token Factory through its OpenAI-compatible chat completions endpoint. */
export class NebiusProvider implements ModelProvider {
  readonly name = "nebius" as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 120_000,
  ) {}

  static fromEnv(env: Record<string, string | undefined> = process.env): NebiusProvider | null {
    if (!env.NEBIUS_API_KEY) return null;
    return new NebiusProvider(env.NEBIUS_API_KEY, env.NEBIUS_BASE_URL || DEFAULT_BASE_URL);
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const t0 = Date.now();
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.2,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Token Factory HTTP ${res.status} for ${req.model}: ${body.slice(0, 300)}`);
    }
    const j = (await res.json()) as ChatCompletion;
    const text = j.choices?.[0]?.message?.content ?? "";
    return {
      text,
      model: j.model ?? req.model,
      promptTokens: j.usage?.prompt_tokens ?? 0,
      completionTokens: j.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - t0,
      simulated: false,
    };
  }
}
