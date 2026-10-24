import { describe, expect, it } from "vitest";
import { argCandidates, measure, shrink, smaller } from "@/lib/core/shrink";
import { argsConform, type TypeSpec } from "@/lib/core/spec";

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
    const fails = (a: unknown[]) => (a[0] as number[]).at(-1)! > 20;
    const r = await shrink([[1, 5, 9, 30, 41]], { isValid: (a) => argsConform(a, spec), stillFails: pred(fails) });
    expect(argsConform(r.minimal, spec)).toBe(true);
    expect(r.minimal).toEqual([[0, 21]]);
  });

  it("drops isolated nodes from graphs given as (n, edge list)", async () => {
    const spec: TypeSpec[] = [{ kind: "graph", n: { min: 1, max: 9 }, m: { min: 0, max: 9 }, weight: { min: -5, max: 5 }, dag: true }];
    // Fails when there is any negative edge.
    const fails = (a: unknown[]) => (a[1] as number[][]).some((e) => e[2] < 0);
    const r = await shrink([8, [[0, 3, 4], [2, 6, -3], [5, 7, 1]]], { isValid: (a) => argsConform(a, spec), stillFails: pred(fails) });
    expect(r.minimal).toEqual([2, [[0, 1, -1]]]);
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
