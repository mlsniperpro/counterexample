import { describe, expect, it } from "vitest";
import { rejectionOf } from "../helpers";
import { ModelOutputError } from "@/lib/errors";
import { extractCode, parseJsonAnswer } from "@/lib/agent/parse";
import { z } from "zod";
import { Budget, DEFAULT_BUDGETS } from "@/lib/agent/budget";
import { CUT_NOTE, ModelCaller, noteCut, readCut, REPLAYED_NOTE } from "@/lib/agent/model-call";
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

describe("an answer cut at max_tokens", () => {
  const answering = (text: string, finishReason: string | undefined, maxTokens: number | undefined = 4096) => {
    const tracer = new Tracer(0, () => 0);
    const provider: ModelProvider = {
      name: "nebius",
      complete: async () => ({ text, model: "nvidia/ultra", promptTokens: 10, completionTokens: 4096, latencyMs: 5, simulated: false, ...(finishReason ? { finishReason } : {}), ...(maxTokens ? { maxTokens } : {}) }),
    };
    const caller = new ModelCaller(provider, models, { "nvidia/ultra": { in: 1, out: 1 } }, new Budget(DEFAULT_BUDGETS, 0, () => 0), tracer);
    return { caller, tracer, ask: () => caller.ask("oracle", "reasoning", "oracle", [{ role: "user", content: "x" }], "k") };
  };

  it("is an error when only an unclosed <think> trace is left, naming the limit", async () => {
    const { ask, caller, tracer } = answering("<think>Let me think about the oracle. First, the brute force would be", "length");
    const err = await rejectionOf<ModelOutputError>(ask());
    expect(err).toBeInstanceOf(ModelOutputError);
    expect(err.message).toBe("output was cut at max_tokens (4096)");
    // The call was made and paid for: it stays in the accounting and the trace.
    expect(caller.stages[0]?.calls).toBe(1);
    expect(tracer.events.some((e) => e.kind === "model_call")).toBe(true);
  });

  it("is an error when nothing is left after a closed trace either, and falls back to the completion tokens for the limit", async () => {
    const { ask } = answering("<think>all of it</think>", "length", 0);
    expect((await rejectionOf<ModelOutputError>(ask())).message).toBe("output was cut at max_tokens (4096)");
  });

  it("returns what is left when text remains, marked cut, and reads a closed answer as before", async () => {
    const { ask } = answering("<think>hm</think>```python\ndef solve(x):\n    return", "length");
    expect(await ask()).toEqual({ text: "```python\ndef solve(x):\n    return", cut: true });
    expect(await answering("<think>unclosed but it stopped", "stop").ask()).toEqual({ text: "<think>unclosed but it stopped", cut: false });
    expect(await answering("fine", undefined).ask()).toEqual({ text: "fine", cut: false });
  });

  it("call() still returns the text, and raises the same error", async () => {
    expect(await answering("```python\nx = 1\n```", "length").caller.call("oracle", "reasoning", "oracle", [{ role: "user", content: "x" }], "k")).toBe("```python\nx = 1\n```");
    const { caller } = answering("<think>", "length");
    await expect(caller.call("oracle", "reasoning", "oracle", [{ role: "user", content: "x" }], "k")).rejects.toThrow("output was cut at max_tokens (4096)");
  });

  it("appends the note to a parse error about a cut answer, and only then", () => {
    const parse = () => extractCode("```python\ndef solve(", "python");
    expect(() => readCut(true, parse)).toThrow(new RegExp(`^no code block found in model output${CUT_NOTE.replace(/[()]/g, "\\$&")}$`));
    expect(() => readCut(false, parse)).toThrow(/^no code block found in model output$/);
    const json = () => parseJsonAnswer("```json\n{\"a\":", z.object({ a: z.number() }), "facts");
    expect(() => readCut(true, json)).toThrow(/no JSON object found in model output \(the answer was cut at max_tokens\)$/);
    // Other errors and values pass through untouched, and the note is never added twice.
    expect(() => readCut(true, () => { throw new TypeError("x"); })).toThrow(TypeError);
    expect(readCut(true, () => 5)).toBe(5);
    const once = noteCut(new ModelOutputError("bad"), true) as Error;
    expect(noteCut(once, true)).toBe(once);
    expect(once.message).toBe(`bad${CUT_NOTE}`);
  });
});
