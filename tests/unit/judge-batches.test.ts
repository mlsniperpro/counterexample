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

describe("Judge.compare with results past one run's total budget", () => {
  it("judges every large result again in a fresh run instead of calling it an oracle failure", async () => {
    const { makeDeps } = await import("@/lib/agent/setup");
    const { executor } = makeDeps({ mode: "replay", env: { NODE_ENV: "test" } });
    const problem = { ...getProblem("binary-search")!, compare: "exact" as const, timeLimitMs: 5000 };
    const judge = new Judge(problem, executor, new Budget(DEFAULT_BUDGETS, 0, () => 0), new Tracer(0, () => 0));
    judge.oracleCode = "def solve(a):\n    return sorted(a)\n";
    // 24 results of about 110,000 characters each: well past the 1,000,000 a run reads.
    const inputs = Array.from({ length: 24 }, (_, i) => [Array.from({ length: 10_000 }, (_, k) => 999_999_999 - ((k * 7919 + i) % 1_000_000_000))]);
    const correct = await judge.compare("run", { language: "python", code: "def solve(a):\n    return sorted(a)\n", entry: "solve" }, inputs);
    expect(correct.map((j) => j.status)).toEqual(inputs.map(() => "agree"));
    // A real difference past the budget is still found, in its place.
    const wrong = await judge.compare("run", { language: "python", code: "def solve(a):\n    return sorted(a)[:-1] if a[0] % 7 == 0 else sorted(a)\n", entry: "solve" }, inputs);
    expect(wrong.map((j) => j.status)).toEqual(inputs.map((x) => ((x[0] as number[])[0]! % 7 === 0 ? "mismatch" : "agree")));
  }, 60_000);

  it("never takes a solution's own error text for an unread result (a thrown string is a mismatch, not a retry)", async () => {
    const { makeDeps } = await import("@/lib/agent/setup");
    const { executor } = makeDeps({ mode: "replay", env: { NODE_ENV: "test" } });
    const budget = new Budget(DEFAULT_BUDGETS, 0, () => 0);
    const judge = new Judge(getProblem("binary-search")!, executor, budget, new Tracer(0, () => 0));
    judge.oracleCode = "def solve(a, t):\n    return -1\n";
    const out = await judge.compare("run", { language: "javascript", code: 'function solve(a, t) { throw "results too large in total (this run\'s results passed 1000000 characters)"; }', entry: "solve" }, [[[1], 2], [[3], 4]]);
    expect(out.map((j) => j.status)).toEqual(["mismatch", "mismatch"]);
    expect(budget.runs).toBe(4);
  }, 60_000);

  it("charges about one run per input and side for verbose outputs, not a re-run of the rest per result read", async () => {
    const { makeDeps } = await import("@/lib/agent/setup");
    const { executor } = makeDeps({ mode: "replay", env: { NODE_ENV: "test" } });
    const problem = { ...getProblem("binary-search")!, compare: "exact" as const, timeLimitMs: 5000 };
    const budget = new Budget(DEFAULT_BUDGETS, 0, () => 0);
    const judge = new Judge(problem, executor, budget, new Tracer(0, () => 0));
    // About 97,000 characters per result: about 10 fit in one run's 1,000,000.
    const code = "def solve(n):\n    return list(range(n))\n";
    judge.oracleCode = code;
    const chunk = (k: number) => Array.from({ length: 64 }, (_, i) => [18_000 + k * 64 + i]);
    const first = await judge.compare("run", { language: "python", code, entry: "solve" }, chunk(0));
    expect(first.every((j) => j.status === "agree")).toBe(true);
    const afterFirst = budget.runs;
    // The first chunk learns what fits: its 64 inputs, the ones re-run, and a few more while the size settles, on both
    // sides (a re-run of the rest per result read charged 576).
    expect(afterFirst).toBeLessThanOrEqual(2 * 64 * 2.5);
    const second = await judge.compare("run", { language: "python", code, entry: "solve" }, chunk(1));
    expect(second.every((j) => j.status === "agree")).toBe(true);
    expect(budget.runs - afterFirst).toBeLessThanOrEqual(2 * 64 * 1.5);
  }, 60_000);
});

describe("Judge.compare when an exact problem's answers are floats", () => {
  it("lets a correct float approximation agree on every input, perfect squares included, and keeps integer answers exact", async () => {
    const { makeDeps } = await import("@/lib/agent/setup");
    const { executor } = makeDeps({ mode: "replay", env: { NODE_ENV: "test" } });
    const problem = { ...getProblem("isqrt")!, compare: "exact" as const };
    const judge = new Judge(problem, executor, new Budget(DEFAULT_BUDGETS, 0, () => 0), new Tracer(0, () => 0));
    // A bisection to 1e-7 against math.sqrt: the oracle's answers for perfect squares are whole (4 -> 2), the solution's are not.
    judge.oracleCode = "import math\ndef solve(x):\n    return math.sqrt(x)\n";
    const bisect = "def solve(x):\n    lo, hi = 0.0, max(1.0, float(x))\n    while hi - lo > 1e-7:\n        mid = (lo + hi) / 2\n        if mid * mid < x: lo = mid\n        else: hi = mid\n    return (lo + hi) / 2\n";
    // Each input on its own and in any company: the verdict depends on the pair of answers, not on what ran before.
    for (const batch of [[[4], [9], [16]], [[4]], [[2], [4]]]) {
      const out = await judge.compare("run", { language: "python", code: bisect, entry: "solve" }, batch);
      expect(out.map((j) => j.status)).toEqual(batch.map(() => "agree"));
    }
    // A bisection that stops at 1e-3 is a real bug, and an integer answer off by one stays a mismatch.
    const coarse = bisect.replace("1e-7", "1e-2");
    expect((await judge.compare("run", { language: "python", code: coarse, entry: "solve" }, [[2]])).map((j) => j.status)).toEqual(["mismatch"]);
    judge.oracleCode = "import math\ndef solve(x):\n    return math.isqrt(x)\n";
    const off = await judge.compare("run", { language: "python", code: "import math\ndef solve(x):\n    return math.isqrt(x) + (x == 10)\n", entry: "solve" }, [[1], [10]]);
    expect(off.map((j) => j.status)).toEqual(["agree", "mismatch"]);
  }, 60_000);
});
