import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cpuClock, runs } from "../helpers";
import { argCandidates, measure, shrink, smaller } from "@/lib/core/shrink";
import { argsConform, SPEC_LIMITS, type TypeSpec } from "@/lib/core/spec";

const pred = (f: (args: unknown[]) => boolean) => async (batch: unknown[][]) => batch.map(f);

describe("shrinker", () => {
  it("shrinks an array to the minimal failing subsequence", async () => {
    // Fails whenever the array contains both 7 and a negative number.
    const fails = (a: unknown[]) => {
      const xs = a[0] as number[];
      return xs.includes(7) && xs.some((x) => x < 0);
    };
    const r = await shrink([[3, 9, 7, 12, -4, 8, 0, 7, 5]], { isValid: () => true, stillFails: pred(fails) });
    expect(r.minimal).toEqual([[-1, 7]]);
    expect(r.steps).toBeGreaterThan(0);
  });

  it("removes an adjacent pair at any offset, so crossed brackets shrink to their core", async () => {
    // A counting-only bracket check (the classic bug) accepts crossed pairs; the correct check does not.
    const counts = (t: string) => [..."([{"].every((o, k) => [...t].filter((c) => c === o).length === [...t].filter((c) => c === ")]}"[k]).length);
    const nested = (t: string) => {
      const st: string[] = [];
      for (const c of t) {
        if ("([{".includes(c)) st.push(c);
        else if (st.pop() !== "([{"[")]}".indexOf(c)]) return false;
      }
      return st.length === 0;
    };
    const fails = (a: unknown[]) => counts(a[0] as string) !== nested(a[0] as string);
    const r = await shrink(["({())}"], { isValid: () => true, stillFails: pred(fails) });
    expect(r.minimal).toEqual(["({)}"]);
  });

  it("shrinks integers towards zero but keeps the failure", async () => {
    const r = await shrink([1_000_003], { isValid: () => true, stillFails: pred((a) => (a[0] as number) >= 1000) });
    expect(r.minimal).toEqual([1000]);
  });

  it("shrinks strings by deleting and simplifying characters", async () => {
    // Fails when some character appears twice with a different one between.
    const fails = (a: unknown[]) => /(.)(?!\1).+\1/.test(a[0] as string);
    const r = await shrink(["dcabbacd"], { isValid: () => true, stillFails: pred(fails) });
    expect((r.minimal[0] as string).length).toBe(3);
  });

  it("respects validity (problem constraints) at every step", async () => {
    const spec: TypeSpec[] = [{ kind: "array", of: { kind: "int", min: 0, max: 50 }, len: { min: 2, max: 10 }, sorted: "asc", distinct: true }];
    const fails = (a: unknown[]) => ((a[0] as number[]).at(-1) ?? 0) > 20;
    const r = await shrink([[1, 5, 9, 30, 41]], { isValid: (a) => argsConform(a, spec), stillFails: pred(fails) });
    expect(argsConform(r.minimal, spec)).toBe(true);
    expect(r.minimal).toEqual([[0, 21]]);
  });

  it("drops isolated nodes from graphs given as (n, edge list)", async () => {
    const spec: TypeSpec[] = [{ kind: "graph", n: { min: 1, max: 9 }, m: { min: 0, max: 9 }, weight: { min: -5, max: 5 }, dag: true }];
    // Fails when there is any negative edge.
    const fails = (a: unknown[]) => (a[1] as number[][]).some((e) => (e[2] ?? 0) < 0);
    const r = await shrink([8, [[0, 3, 4], [2, 6, -3], [5, 7, 1]]], { isValid: (a) => argsConform(a, spec), stillFails: pred(fails) });
    expect(r.minimal).toEqual([2, [[0, 1, -1]]]);
  });

  it("drops isolated nodes in bulk first, relabelling the rest", () => {
    const nodeCounts = [...argCandidates([6, [[0, 3, 1], [3, 5, 2]]])].map((c) => c[0]);
    // Isolated: 1, 2, 4. All of them at once, then the upper half (4), then one at a time.
    expect(nodeCounts.slice(0, 5)).toEqual([3, 5, 5, 5, 5]);
    expect([...argCandidates([6, [[0, 3, 1], [3, 5, 2]]])][0]).toEqual([3, [[0, 1, 1], [1, 2, 2]]]);
    expect([...argCandidates([6, [[0, 3, 1], [3, 5, 2]]])][1]).toEqual([5, [[0, 3, 1], [3, 4, 2]]]);
  });

  describe("a fixed-length input, where every removal is invalid", () => {
    const N = 3000;
    const start = [Array.from({ length: N }, () => 1)];
    const fixedLength = (a: unknown[]) => (a[0] as number[]).length === N;

    it("keeps the event loop responsive while it skips the invalid candidates", async () => {
      let last = performance.now();
      let worstGap = 0;
      const timer = setInterval(() => {
        const now = performance.now();
        worstGap = Math.max(worstGap, now - last);
        last = now;
      }, 5);
      const r = await shrink(start, { isValid: fixedLength, stillFails: pred(() => false), maxEvals: 50 });
      clearInterval(timer);
      expect(r.minimal).toEqual(start);
      // About 4N candidates of N values each: tens of millions of values, in slices of 100,000.
      expect(worstGap).toBeLessThan(1000);
    });

    it("stops at the scan budget, keeping the input so far and saying it may not be minimal", async () => {
      const r = await shrink(start, { isValid: fixedLength, stillFails: pred(() => false), maxScan: 1_000_000 });
      expect(r).toMatchObject({ minimal: start, exhausted: true, evals: 0 });
    });

    it("stops when the attack is aborted, without judging anything more", async () => {
      let judged = 0;
      const r = await shrink(start, { isValid: fixedLength, stillFails: async (b) => ((judged += b.length), b.map(() => false)), signal: AbortSignal.abort() });
      expect(r).toMatchObject({ minimal: start, exhausted: true });
      expect(judged).toBe(0);
    });
  });

  it("treats an int followed by pairs as a graph only when it could be one", () => {
    // solve(k, nums) with k = 2^31 - 1 and nums shrunk to []: no per-node loop over two billion nodes.
    const cpu = cpuClock();
    const first = argCandidates([2147483647, []]).next().value;
    expect(cpu()).toBeLessThan(100);
    expect(first).not.toEqual([1, []]);
    // n above the graph limit, or an endpoint outside 0..n-1: shrunk as plain values, never relabelled.
    for (const args of [[SPEC_LIMITS.maxNodes + 1, [[0, 1, 1]]], [6, [[0, 7, 1]]], [6, [[-1, 3, 1]]]]) {
      const cands = [...argCandidates(args)];
      expect(cands.every((c) => c[0] !== (args[0] as number) - 1 || c[1] === args[1])).toBe(true);
    }
    // A real graph still gets the bulk drop.
    expect([...argCandidates([6, [[0, 3, 1], [3, 5, 2]]])][0]).toEqual([3, [[0, 1, 1], [1, 2, 2]]]);
  });

  it("shrinks a 1000-node graph with one edge to two nodes within a small budget", async () => {
    const spec: TypeSpec[] = [{ kind: "graph", n: { min: 1, max: 1000 }, m: { min: 0, max: 10 }, weight: { min: 0, max: 9 }, dag: true }];
    const fails = (a: unknown[]) => (a[1] as number[][]).length > 0;
    const r = await shrink([1000, [[0, 1, 5]]], { isValid: (a) => argsConform(a, spec), stillFails: pred(fails), maxEvals: 300 });
    expect(r.exhausted).toBe(false);
    expect((r.minimal as [number, number[][]])[0]).toBe(2);
    expect(r.evals).toBeLessThan(300);
  });

  it("falls back to single-node drops when a bulk drop loses the failure", async () => {
    const spec: TypeSpec[] = [{ kind: "graph", n: { min: 1, max: 20 }, m: { min: 0, max: 5 }, weight: { min: 0, max: 9 } }];
    // Fails only for exactly 6 nodes, whatever the edges: bulk drops go too far, one node at a time stays on the line.
    const fails = (a: unknown[]) => a[0] === 6;
    const r = await shrink([12, [[0, 1, 0]]], { isValid: (a) => argsConform(a, spec), stillFails: pred(fails) });
    expect((r.minimal as [number, number[][]])[0]).toBe(6);
  });

  it("most candidates are strictly smaller, and the driver only accepts those", async () => {
    const start = [[5, -3, 8], "abc", 17];
    const cands = [...argCandidates(start)];
    expect(cands.filter((c) => smaller(c, start)).length).toBeGreaterThan(cands.length / 2);
    const seen: unknown[][] = [];
    await shrink(start, { isValid: () => true, stillFails: async (b) => (seen.push(...b), b.map(() => false)) });
    for (const c of seen) expect(smaller(c, start)).toBe(true);
    expect(measure([1, 2])).toEqual([3, 3]);
  });

  it("stops at the evaluation budget", async () => {
    const r = await shrink([Array.from({ length: 200 }, (_, i) => i)], {
      isValid: () => true,
      stillFails: pred(() => false),
      maxEvals: 10,
      batchSize: 4,
    });
    expect(r.exhausted).toBe(true);
    expect(r.evals).toBeLessThanOrEqual(10);
  });
});

describe("shrinker properties", () => {
  // Failure predicates over (int array, int) inputs that are monotone-ish, so a failing input exists and shrinking has work to do.
  const predicates: [string, (a: unknown[]) => boolean][] = [
    ["sum > k", (a) => (a[0] as number[]).reduce((x, y) => x + y, 0) > (a[1] as number)],
    ["has duplicate", (a) => new Set(a[0] as number[]).size < (a[0] as number[]).length],
    ["max - min >= k", (a) => {
      const xs = a[0] as number[];
      return xs.length > 0 && Math.max(...xs) - Math.min(...xs) >= Math.abs(a[1] as number);
    }],
  ];
  const input = fc.tuple(fc.array(fc.integer({ min: -50, max: 50 }), { maxLength: 12 }), fc.integer({ min: -20, max: 20 }));

  for (const [name, fails] of predicates) {
    it(`${name}: result still fails, is valid, no larger, and locally minimal`, async () => {
      await fc.assert(
        fc.asyncProperty(input, async (start) => {
          fc.pre(fails(start));
          const isValid = (a: unknown[]) => (a[0] as number[]).length <= 12;
          const r = await shrink(start, { isValid, stillFails: pred(fails) });
          expect(fails(r.minimal)).toBe(true);
          expect(isValid(r.minimal)).toBe(true);
          expect(JSON.stringify(r.minimal) === JSON.stringify(start) || smaller(r.minimal, start)).toBe(true);
          expect(r.exhausted).toBe(false);
          for (const c of argCandidates(r.minimal)) {
            if (smaller(c, r.minimal) && isValid(c)) expect(fails(c)).toBe(false);
          }
        }),
        { numRuns: runs(60) },
      );
    });
  }

  it("is deterministic", async () => {
    await fc.assert(
      fc.asyncProperty(input, async (start) => {
        const fails = predicates[0]![1];
        fc.pre(fails(start));
        const a = await shrink(start, { isValid: () => true, stillFails: pred(fails) });
        const b = await shrink(start, { isValid: () => true, stillFails: pred(fails) });
        expect(a).toEqual(b);
      }),
      { numRuns: runs(50) },
    );
  });

  it("propagates a failing evaluator instead of swallowing it", async () => {
    await expect(shrink([[1, 2, 3]], { isValid: () => true, stillFails: async () => Promise.reject(new Error("sandbox down")) })).rejects.toThrow("sandbox down");
  });
});
