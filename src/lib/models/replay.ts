import { ReplayMissError } from "../errors";
import type { ModelProvider, ModelRequest, ModelResponse, Purpose } from "./types";

/**
 * Recorded model responses: fixtures[replayKey][purpose] is either one text or
 * a list (one per attempt; the last one repeats).
 */
export type ReplayFixtures = Record<string, Partial<Record<Purpose, string | string[]>>>;

const estimateTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

/**
 * Simulated decode speed per model class, for fixture-mode latency only.
 * Big reasoning models are slower per token than small fast ones.
 */
function simulatedLatency(model: string, prompt: number, completion: number): number {
  const ultra = /ultra/i.test(model);
  const ttft = ultra ? 900 : 250;
  const msPerTok = ultra ? 18 : 6;
  return Math.round(ttft + prompt * 0.05 + completion * msPerTok);
}

/**
 * Deterministic replay provider: returns recorded responses so the whole agent
 * loop runs in tests (and for judges) without an API key. Token counts are
 * estimated from text length and latency is simulated, and both are marked so.
 */
export class ReplayProvider implements ModelProvider {
  readonly name = "replay" as const;

  constructor(
    private readonly fixtures: ReplayFixtures,
    private readonly fallbackKeys: (key: string) => string[] = () => [],
  ) {}

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const keys = [req.replayKey, ...this.fallbackKeys(req.replayKey)];
    let entry: string | string[] | undefined;
    for (const k of keys) {
      entry = this.fixtures[k]?.[req.purpose];
      if (entry !== undefined) break;
    }
    if (entry === undefined) {
      throw new ReplayMissError(
        `replay: no recorded "${req.purpose}" response for "${req.replayKey}". ` +
          `Replay mode only covers the built-in problems; set NEBIUS_API_KEY for live mode.`,
      );
    }
    const list = Array.isArray(entry) ? entry : [entry];
    const text = list[Math.min(req.attempt ?? 0, list.length - 1)];
    if (text === undefined) throw new ReplayMissError(`replay: empty response list for "${req.purpose}" / "${req.replayKey}"`);
    const promptTokens = estimateTokens(req.messages.map((m) => m.content).join("\n"));
    const completionTokens = estimateTokens(text);
    return {
      text,
      model: req.model,
      promptTokens,
      completionTokens,
      latencyMs: simulatedLatency(req.model, promptTokens, completionTokens),
      simulated: true,
    };
  }
}

/**
 * Wraps a live provider and records every response into a fixtures object,
 * so a live run can be saved and replayed later (pnpm bench --record).
 */
export class RecordingProvider implements ModelProvider {
  readonly name = "recording" as const;
  readonly recorded: ReplayFixtures = {};

  constructor(private readonly inner: ModelProvider) {}

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const res = await this.inner.complete(req);
    const slot = (this.recorded[req.replayKey] ??= {});
    const prev = slot[req.purpose];
    slot[req.purpose] = prev === undefined ? res.text : [...(Array.isArray(prev) ? prev : [prev]), res.text];
    return res;
  }
}
