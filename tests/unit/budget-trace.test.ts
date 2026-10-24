import { describe, expect, it } from "vitest";
import { Budget, DEFAULT_BUDGETS } from "@/lib/agent/budget";
import { Tracer, type TraceEvent } from "@/lib/agent/trace";
import { AttackCancelled, BudgetExceeded } from "@/lib/errors";

describe("Budget", () => {
  const limits = { ...DEFAULT_BUDGETS, maxModelCalls: 2, maxRuns: 10, wallClockMs: 100 };

  it("counts model calls and runs and throws a typed error past the limit", () => {
    const b = new Budget(limits, 0, () => 0);
    b.useModelCall();
    b.useModelCall();
    expect(() => b.useModelCall()).toThrow(BudgetExceeded);
    expect(b.modelCalls).toBe(2);
    b.useRuns(7);
    expect(b.remainingRuns()).toBe(3);
    const e = (() => {
      try {
        b.useRuns(4);
      } catch (x) {
        return x;
      }
    })();
    expect(e).toBeInstanceOf(BudgetExceeded);
    expect((e as BudgetExceeded).budget).toBe("runs");
    expect(b.runs).toBe(7); // a refused reservation is not charged
  });

  it("enforces the wall clock", () => {
    let now = 0;
    const b = new Budget(limits, 0, () => now);
    b.checkTime();
    now = 101;
    expect(() => b.useRuns(1)).toThrow(/wallClock/);
    expect(b.elapsed()).toBe(101);
  });

  it("stops on cancellation", () => {
    const ac = new AbortController();
    const b = new Budget(limits, 0, () => 0, ac.signal);
    b.useModelCall();
    ac.abort();
    expect(() => b.useModelCall()).toThrow(AttackCancelled);
  });
});

describe("Tracer", () => {
  it("numbers events, timestamps them relative to t0, and streams them to a sink", () => {
    let now = 1000;
    const seen: TraceEvent[] = [];
    const t = new Tracer(1000, () => now, (e) => seen.push(e));
    t.emit("run", "info", "a");
    now = 1250;
    t.emit("shrink", "counterexample", "b", { args: [1] });
    expect(t.events).toEqual(seen);
    expect(t.events.map((e) => [e.seq, e.t, e.stage])).toEqual([
      [0, 0, "run"],
      [1, 250, "shrink"],
    ]);
    expect(t.events[0]).not.toHaveProperty("data");
    const lines = t.jsonl().trimEnd().split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual(t.events);
  });
});
