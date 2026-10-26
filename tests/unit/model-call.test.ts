import { describe, expect, it } from "vitest";
import { Budget, DEFAULT_BUDGETS } from "@/lib/agent/budget";
import { ModelCaller, REPLAYED_NOTE } from "@/lib/agent/model-call";
import { Tracer } from "@/lib/agent/trace";
import type { ModelProvider } from "@/lib/models/types";

const models = { reasoningModel: "nvidia/ultra", fastModel: "nvidia/super", routing: "routed" as const };

/** One generator call through a provider with the given name, answering with the given `simulated` flag; returns its model_call trace line. */
async function traceLine(name: ModelProvider["name"], simulated: boolean): Promise<string> {
  const tracer = new Tracer(0, () => 0);
  const provider: ModelProvider = {
    name,
    complete: async () => ({ text: "ok", model: "nvidia/super", promptTokens: 1, completionTokens: 1, latencyMs: 5, simulated }),
  };
  const caller = new ModelCaller(provider, models, { "nvidia/super": { in: 1, out: 1 } }, new Budget(DEFAULT_BUDGETS, 0, () => 0), tracer);
  await caller.call("attack", "fast", "generators", [{ role: "user", content: "x" }], "k");
  return tracer.events.find((e) => e.kind === "model_call")!.msg;
}

describe("model_call trace line", () => {
  it("says a simulated answer is replayed, not a live call", async () => {
    expect(await traceLine("replay", true)).toBe(`generators via nvidia/super${REPLAYED_NOTE}`);
    expect(REPLAYED_NOTE).toBe(" (replayed answer, not a live call)");
  });

  it("also says so when only the provider is named replay", async () => {
    expect(await traceLine("replay", false)).toContain("(replayed answer, not a live call)");
  });

  it("leaves a live call's line plain", async () => {
    expect(await traceLine("nebius", false)).toBe("generators via nvidia/super");
  });
});
