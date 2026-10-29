import { describe, expect, it } from "vitest";
import { DEFAULT_FAST_MODEL, DEFAULT_REASONING_MODEL, modelConfigFromEnv, modelFor } from "@/lib/models/config";
import { costUsd, DEFAULT_PRICES, priceTable } from "@/lib/models/pricing";
import { ConfigError } from "@/lib/errors";

describe("pricing", () => {
  it("prices tokens per million, and reports unknown models as unpriced (null)", () => {
    expect(costUsd("a", 1_000_000, 1_000_000, { a: { in: 1, out: 3 } })).toBe(4);
    expect(costUsd("a", 0, 0, { a: { in: 1, out: 3 } })).toBe(0);
    expect(costUsd("unknown", 10, 10, { a: { in: 1, out: 3 } })).toBeNull();
  });

  it("merges MODEL_PRICES over the defaults", () => {
    const t = priceTable({ MODEL_PRICES: '{"x":{"in":2,"out":4}}' });
    expect(t.x).toEqual({ in: 2, out: 4 });
    expect(t[DEFAULT_REASONING_MODEL]).toEqual(DEFAULT_PRICES[DEFAULT_REASONING_MODEL]);
    expect(priceTable({})).toEqual(DEFAULT_PRICES);
  });

  it("refuses a malformed MODEL_PRICES instead of ignoring it", () => {
    expect(() => priceTable({ MODEL_PRICES: "{nope" })).toThrow(ConfigError);
    expect(() => priceTable({ MODEL_PRICES: '{"x":{"in":-1,"out":1}}' })).toThrow(ConfigError);
    expect(() => priceTable({ MODEL_PRICES: '{"x":{"in":1}}' })).toThrow(/MODEL_PRICES/);
  });
});

describe("model config and routing", () => {
  it("defaults to the documented Nemotron ids and reads overrides", () => {
    expect(modelConfigFromEnv({})).toEqual({ reasoningModel: DEFAULT_REASONING_MODEL, fastModel: DEFAULT_FAST_MODEL, routing: "routed" });
    expect(modelConfigFromEnv({ MODEL_REASONING: "r", MODEL_FAST: "f" }, "ultra-only")).toEqual({ reasoningModel: "r", fastModel: "f", routing: "ultra-only" });
  });

  it("routes by role, or everything to the reasoning model", () => {
    const cfg = modelConfigFromEnv({ MODEL_REASONING: "ultra", MODEL_FAST: "nano" });
    expect(modelFor(cfg, "reasoning")).toBe("ultra");
    expect(modelFor(cfg, "fast")).toBe("nano");
    expect(modelFor({ ...cfg, routing: "ultra-only" }, "fast")).toBe("ultra");
  });
});
