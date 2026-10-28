import { describe, expect, it } from "vitest";
import { byValues, Judge, JUDGE_BATCH_VALUES } from "@/lib/agent/judge";
import { ranBefore } from "@/lib/agent/stages";
import { Budget, DEFAULT_BUDGETS } from "@/lib/agent/budget";
import { Tracer } from "@/lib/agent/trace";
import type { Executor, RunRequest } from "@/lib/exec/types";
import { ExecutorError } from "@/lib/errors";
import { getProblem } from "@/lib/problems/catalog";

describe("byValues", () => {
  it("keeps order, never exceeds the limit with more than one input, and gives an oversized input a batch of its own", () => {
    const xs = [[[1, 2, 3]], [[4]], [new Array(10).fill(0)], [[5, 6]], [[7]]];
    // Sizes, every list counted: 5, 3, 12, 4 and 3.
    const groups = byValues(xs, 9);
    expect(groups.flat()).toEqual(xs);
    expect(groups.map((g) => g.length)).toEqual([2, 1, 2]);
    expect(byValues([], 9)).toEqual([]);
    // A batch that reaches the limit exactly stays one batch.
    expect(byValues([[[1, 2, 3]], [[4, 5, 6]]], 10)).toHaveLength(1);
    expect(byValues([[[1, 2, 3]], [[4, 5, 6, 7]]], 10)).toHaveLength(2);
  });
});

describe("Judge.compare in value-bounded batches", () => {
  it("sends no executor call more than JUDGE_BATCH_VALUES values (unless one input is over it alone), and keeps every judgement in place", async () => {
    const sent: number[] = [];
    const executor: Executor = {
      name: "fake",
      label: "fake",
      run: async (req: RunRequest) => {
        sent.push(req.inputs.reduce((n, x) => n + ((x[0] as unknown[]).length + 2), 0));
        return { outcomes: req.inputs.map((x) => ({ ok: true as const, out: (x[0] as unknown[]).length, ms: 1 })), processes: 1 };
      },
    } as unknown as Executor;
    const problem = getProblem("binary-search")!;
    const judge = new Judge(problem, executor, new Budget(DEFAULT_BUDGETS, 0, () => 0), new Tracer(0, () => 0));
    const inputs = Array.from({ length: 16 }, (_, i) => [new Array(60_000 + i).fill(0), 1]);
    const out = await judge.compare("shrink", { language: "python", code: "x", entry: "solve" }, inputs);
    expect(out).toHaveLength(16);
    expect(out.every((j) => j.status === "agree")).toBe(true);
    // Solution and oracle both run every batch; each batch holds at most four of these 60,000-value inputs.
    expect(sent.length).toBeGreaterThan(2);
    expect(Math.max(...sent)).toBeLessThanOrEqual(JUDGE_BATCH_VALUES + 10);
  });
});

describe("Judge.compare under the problem's comparison mode", () => {
  it("compares as the problem says: the same list in another order agrees when unordered, not when exact", async () => {
    const executor = {
      name: "fake",
      label: "fake",
      run: async (req: RunRequest) => ({ outcomes: req.inputs.map(() => ({ ok: true as const, out: req.code === "oracle" ? [2, 1] : [1, 2], ms: 1 })), processes: 1 }),
    } as unknown as Executor;
    const judgeFor = (compare: "exact" | "unordered") => {
      const j = new Judge({ ...getProblem("binary-search")!, compare }, executor, new Budget(DEFAULT_BUDGETS, 0, () => 0), new Tracer(0, () => 0));
      j.oracleCode = "oracle";
      return j;
    };
    const sol = { language: "python" as const, code: "x", entry: "solve" };
    expect((await judgeFor("unordered").compare("run", sol, [[[1], 1]]))[0]?.status).toBe("agree");
    expect((await judgeFor("exact").compare("run", sol, [[[1], 1]]))[0]?.status).toBe("mismatch");
  });
});

describe("Judge.compare with a short answer from the executor", () => {
  it("throws ExecutorError (which the attack degrades on), not a TypeError, when the oracle's run returns too few outcomes", async () => {
    const executor = {
      name: "fake",
      label: "fake",
      run: async (req: RunRequest) => {
        const n = req.code === "oracle" ? req.inputs.length - 1 : req.inputs.length;
        return { outcomes: req.inputs.slice(0, n).map(() => ({ ok: true as const, out: 1, ms: 1 })), processes: 1 };
      },
    } as unknown as Executor;
    const judge = new Judge(getProblem("binary-search")!, executor, new Budget(DEFAULT_BUDGETS, 0, () => 0), new Tracer(0, () => 0));
    judge.oracleCode = "oracle";
    await expect(judge.compare("run", { language: "python", code: "x", entry: "solve" }, [[[1], 1], [[2], 2]])).rejects.toThrow(ExecutorError);
  });
});

describe("ranBefore (what ran before an input in its own process)", () => {
  it("is the whole prefix for small inputs, and only the prefix within the input's batch for large ones", () => {
    const small = [[1], [2], [3]];
    expect(ranBefore(small, small[2]!)).toEqual([[1], [2]]);
    expect(ranBefore(small, small[0]!)).toEqual([]);
    // Inputs of 100,000 values: two fit a 250,000-value batch, so the third starts a new process.
    const big = Array.from({ length: 4 }, (_, i) => [new Array(100_000).fill(i)]);
    expect(ranBefore(big, big[1]!)).toEqual([big[0]]);
    expect(ranBefore(big, big[2]!)).toEqual([]);
    expect(ranBefore(big, big[3]!)).toEqual([big[2]]);
  });
});
