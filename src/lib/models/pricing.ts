import { z } from "zod";
import { ConfigError } from "../errors";

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

const pricesSchema = z.record(z.string().min(1), z.object({ in: z.number().min(0), out: z.number().min(0) }));

/** Price table from defaults plus MODEL_PRICES. A malformed MODEL_PRICES is a configuration error, not ignored. */
export function priceTable(env: Record<string, string | undefined> = process.env): Record<string, Price> {
  if (!env.MODEL_PRICES) return { ...DEFAULT_PRICES };
  let json: unknown;
  try {
    json = JSON.parse(env.MODEL_PRICES);
  } catch (e) {
    throw new ConfigError("MODEL_PRICES is not valid JSON", { cause: e });
  }
  const r = pricesSchema.safeParse(json);
  if (!r.success) throw new ConfigError(`MODEL_PRICES: ${z.prettifyError(r.error)}`);
  return { ...DEFAULT_PRICES, ...r.data };
}

/** Price for a model id, matching case-insensitively (providers may echo ids with different casing). */
export function priceFor(model: string, table: Record<string, Price>): Price | undefined {
  const exact = table[model];
  if (exact) return exact;
  const lower = model.toLowerCase();
  return Object.entries(table).find(([k]) => k.toLowerCase() === lower)?.[1];
}

/** Cost of one call, or null when the model has no known price (reported as unpriced, never guessed). */
export function costUsd(model: string, promptTokens: number, completionTokens: number, table: Record<string, Price>): number | null {
  const p = priceFor(model, table);
  if (!p) return null;
  return (promptTokens * p.in + completionTokens * p.out) / 1e6;
}
