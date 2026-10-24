/**
 * USD per million tokens. Defaults are from third-party Token Factory price
 * listings (Oct 2026) and must be checked against the Token Factory console;
 * override with MODEL_PRICES='{"model-id":{"in":1,"out":3}}'.
 */
export type Price = { in: number; out: number };

export const DEFAULT_PRICES: Record<string, Price> = {
  "nvidia/Nemotron-3-Ultra-550b-a55b": { in: 1.0, out: 3.0 },
  "nvidia/nemotron-3-super-120b-a12b": { in: 0.3, out: 0.9 },
};

const FALLBACK: Price = { in: 1.0, out: 3.0 };

export function priceTable(env: Record<string, string | undefined> = process.env): Record<string, Price> {
  let extra: Record<string, Price> = {};
  if (env.MODEL_PRICES) {
    try {
      extra = JSON.parse(env.MODEL_PRICES);
    } catch {
      extra = {};
    }
  }
  return { ...DEFAULT_PRICES, ...extra };
}

export function costUsd(model: string, promptTokens: number, completionTokens: number, table = priceTable()): number {
  const p = table[model] ?? FALLBACK;
  return (promptTokens * p.in + completionTokens * p.out) / 1e6;
}
