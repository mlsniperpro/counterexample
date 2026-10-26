import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildProgram, MAX_RESULT_CHARS, parseLines, reachedReady, runWithRestarts } from "@/lib/exec/program";
import type { ChunkResult, RunOutcome } from "@/lib/exec/types";
import { outputsEqual, showValue } from "@/lib/core/compare";
import { chunkLimit } from "@/lib/exec/judge0";

describe("harness program", () => {
  it("rejects entry names that are not identifiers (no code injection through the entry name)", () => {
    for (const bad of ["solve(); import os", "a b", "1x", "", "x;"]) expect(() => buildProgram("python", "", bad)).toThrow(/invalid entry/);
    for (const ok of ["solve", "_x1", "$f"]) expect(() => buildProgram("javascript", "", ok)).not.toThrow();
  });

  it("loads Python as its own module and appends the harness after JavaScript code", () => {
    const code = "def solve(x):\n    return x\n";
    const py = buildProgram("python", code, "solve");
    expect(py).toContain(Buffer.from(code).toString("base64"));
    expect(py).toContain('__f = getattr(__cx_mod, "solve")');
    const js = buildProgram("javascript", "export default function solve(x) { return x; }", "solve");
    expect(js.startsWith("function solve")).toBe(true);
    expect(js).toContain("const __f = solve;");
  });

  it("parses only marked record lines and tolerates a line cut by a kill", () => {
    const out = 'noise {"ok":true}\n\x1eCR\n\x1eCX{"ok":true,"out":2,"ms":1}\n\x1eCX{"ok":false,"error":"runtime","message":"ZeroDivisionError"}\n\x1eCX{"ok":tr';
    expect(parseLines(out)).toEqual([
      { ok: true, out: 2, ms: 1 },
      { ok: false, error: "runtime", message: "ZeroDivisionError" },
    ]);
    expect(reachedReady(out)).toBe(true);
    expect(reachedReady("\x1eCX")).toBe(false);
  });
});

describe("runWithRestarts", () => {
  /** A fake sandbox: each input either succeeds, hangs or crashes the process. */
  const fake = (kinds: ("ok" | "hang" | "crash")[], maxChunk = Infinity) => {
    const starts: number[] = [];
    const runChunk = async (chunk: unknown[][]): Promise<ChunkResult> => {
      starts.push((chunk[0] as number[])[0]!);
      const lines: RunOutcome[] = [];
      for (const [i] of chunk as number[][]) {
        const k = kinds[i!];
        if (k === "hang") return { lines, end: "timeout", message: "tle" };
        if (k === "crash") return { lines, end: "crash", message: "segfault" };
        lines.push({ ok: true, out: i, ms: 0 });
      }
      return { lines, end: "ok", message: "" };
    };
    return { runChunk, starts, maxChunk };
  };

  it("returns exactly one outcome per input, blaming the right ones, for any pattern of hangs and crashes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom<"ok" | "hang" | "crash">("ok", "ok", "ok", "hang", "crash"), { maxLength: 30 }), fc.integer({ min: 1, max: 10 }), async (kinds, chunk) => {
        const f = fake(kinds, chunk);
        const inputs = kinds.map((_, i) => [i]);
        const r = await runWithRestarts(inputs, f.runChunk, chunk);
        expect(r.outcomes).toHaveLength(kinds.length);
        r.outcomes.forEach((o, i) => {
          const k = kinds[i];
          if (k === "ok") expect(o).toEqual({ ok: true, out: i, ms: 0 });
          else expect(o).toMatchObject({ ok: false, error: k === "hang" ? "timeout" : "runtime" });
        });
        expect(r.processes).toBe(f.starts.length);
      }),
    );
  });

  it("marks every input as a compile error after one failed start", async () => {
    let calls = 0;
    const r = await runWithRestarts([[1], [2], [3]], async () => {
      calls++;
      return { lines: [], end: "compile", message: "SyntaxError" };
    });
    expect(calls).toBe(1);
    expect(r.outcomes).toEqual(Array(3).fill({ ok: false, error: "compile", message: "SyntaxError" }));
  });

  it("flags a process that exits cleanly but reports too few lines as an internal error", async () => {
    const r = await runWithRestarts([[1], [2]], async (chunk) => ({ lines: chunk.length === 2 ? [{ ok: true, out: 1, ms: 0 }] : [{ ok: true, out: 2, ms: 0 }], end: "ok", message: "" }));
    expect(r.outcomes[1]).toMatchObject({ ok: false, error: "internal" });
  });

  it("handles no inputs without starting a process", async () => {
    const r = await runWithRestarts([], async () => {
      throw new Error("should not run");
    });
    expect(r).toEqual({ outcomes: [], processes: 0 });
  });
});

describe("runWithRestarts with a time limit shared by the chunk (Judge0)", () => {
  /** A chunk "times out" once its inputs' total cost passes the budget; a lone input only when it alone does. */
  const sharedBudget = (cost: number[], budget: number) => {
    const chunks: number[][] = [];
    const runChunk = async (chunk: unknown[][]): Promise<ChunkResult> => {
      chunks.push((chunk as number[][]).map(([i]) => i!));
      const lines: RunOutcome[] = [];
      let used = 0;
      for (const [i] of chunk as number[][]) {
        used += cost[i!]!;
        if (used > budget) return { lines, end: "timeout", message: "tle" };
        lines.push({ ok: true, out: i, ms: 0 });
      }
      return { lines, end: "ok", message: "" };
    };
    return { runChunk, chunks };
  };

  it("does not blame an innocent input when slow but legal earlier inputs used up the chunk's budget", async () => {
    const f = sharedBudget([4, 4, 4, 1], 10);
    const r = await runWithRestarts([[0], [1], [2], [3]], f.runChunk, Infinity, 1000);
    expect(r.outcomes).toEqual([0, 1, 2, 3].map((i) => ({ ok: true, out: i, ms: 0 })));
    expect(f.chunks).toEqual([[0, 1, 2, 3], [2], [3]]);
    expect(r.processes).toBe(3);
  });

  it("still blames an input that times out on its own", async () => {
    const f = sharedBudget([1, 50, 1], 10);
    const r = await runWithRestarts([[0], [1], [2]], f.runChunk, Infinity, 1000);
    expect(r.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([0, "timeout", 2]);
    expect(f.chunks).toEqual([[0, 1, 2], [1], [2]]);
  });

  it("re-runs a crash in a shared chunk alone before blaming the next input (memory is shared too)", async () => {
    // The chunk crashes once its inputs' total weight passes 10; each input alone is fine, and input 1 is too heavy even alone.
    const crashing = (weight: number[]) => {
      const chunks: number[][] = [];
      const runChunk = async (chunk: unknown[][]): Promise<ChunkResult> => {
        chunks.push((chunk as number[][]).map(([i]) => i!));
        const lines: RunOutcome[] = [];
        let used = 0;
        for (const [i] of chunk as number[][]) {
          used += weight[i!]!;
          if (used > 10) return { lines, end: "crash", message: "Runtime Error (SIGSEGV)" };
          lines.push({ ok: true, out: i, ms: 0 });
        }
        return { lines, end: "ok", message: "" };
      };
      return { runChunk, chunks };
    };
    const innocent = crashing([4, 4, 4, 1]);
    const r = await runWithRestarts([[0], [1], [2], [3]], innocent.runChunk, Infinity, 1000);
    expect(r.outcomes).toEqual([0, 1, 2, 3].map((i) => ({ ok: true, out: i, ms: 0 })));
    expect(innocent.chunks).toEqual([[0, 1, 2, 3], [2], [3]]);
    const guilty = crashing([1, 50, 1]);
    const g = await runWithRestarts([[0], [1], [2]], guilty.runChunk, Infinity, 1000);
    expect(g.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([0, "runtime", 2]);
    expect(guilty.chunks).toEqual([[0, 1, 2], [1], [2]]);
  });

  it("halves the chunk size after a timeout in a multi-input chunk, so hanging inputs stop costing whole shared budgets", async () => {
    const limit = 1000;
    // Every input from 8 on hangs. A chunk of n inputs shares n * limit; a timeout burns all of it, a clean run costs 1 ms per input.
    const run = async (maxChunk: number) => {
      let simulatedMs = 0;
      let submissions = 0;
      const runChunk = async (chunk: unknown[][]): Promise<ChunkResult> => {
        submissions++;
        const lines: RunOutcome[] = [];
        for (const [i] of chunk as number[][]) {
          if (i! >= 8) {
            simulatedMs += limit * chunk.length;
            return { lines, end: "timeout", message: "tle" };
          }
          simulatedMs++;
          lines.push({ ok: true, out: i, ms: 1 });
        }
        return { lines, end: "ok", message: "" };
      };
      const r = await runWithRestarts(Array.from({ length: 64 }, (_, i) => [i]), runChunk, maxChunk, limit);
      return { outcomes: r.outcomes, submissions, simulatedMs };
    };
    const r = await run(16);
    expect(r.outcomes.map((o) => (o.ok ? "ok" : o.error))).toEqual([...Array(8).fill("ok"), ...Array(56).fill("timeout")]);
    // Fixed chunks of 16 (the behaviour before): 111 submissions and 831008 ms, each hang costing a full shared chunk plus a solo run.
    expect(r.submissions).toBe(60);
    expect(r.simulatedMs).toBe(86_008);
  });

  it("without the flag keeps the cheaper blame-and-restart (per-input watchdogs, e.g. the local executor)", async () => {
    const f = sharedBudget([4, 4, 4, 1], 10);
    const r = await runWithRestarts([[0], [1], [2], [3]], f.runChunk);
    expect(r.outcomes[2]).toMatchObject({ ok: false, error: "timeout" });
    expect(r.processes).toBe(2);
  });
});

describe("harness output parsing keeps big integers exact", () => {
  it("turns integer literals beyond 2^53 into exact values, leaving safe numbers and floats alone", () => {
    const [a, b, c] = parseLines(
      '\x1eCX{"ok":true,"out":999999998000000001,"ms":1}\n\x1eCX{"ok":true,"out":999999998000000000,"ms":1}\n\x1eCX{"ok":true,"out":[1.5e300,7],"ms":1}\n',
    );
    expect(a?.ok && b?.ok && c?.ok).toBe(true);
    if (!a?.ok || !b?.ok || !c?.ok) return;
    expect(outputsEqual(a.out, b.out)).toBe(false);
    expect(showValue(a.out)).toBe("999999998000000001");
    expect(c.out).toEqual([1.5e300, 7]);
  });
});

describe("Judge0 chunk size", () => {
  it("keeps every input's full time limit inside the 15 s CPU cap", () => {
    expect(chunkLimit(200, 300)).toBe(48);
    expect(chunkLimit(200, 50)).toBe(200);
    expect(chunkLimit(200, 20_000)).toBe(1);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), fc.integer({ min: 1, max: 60_000 }), (size, limit) => {
        const n = chunkLimit(size, limit);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(size);
        if (n > 1) expect((n * limit) / 1000 + 0.5).toBeLessThanOrEqual(15);
      }),
    );
  });
});

describe("runWithRestarts enforces the per-input limit when the chunk finished (Judge0)", () => {
  /** Each input reports a measured time; `soloMs` overrides it when the input runs alone. */
  const timed = (ms: number[], soloMs: Record<number, number> = {}) => {
    const chunks: number[][] = [];
    const runChunk = async (chunk: unknown[][]): Promise<ChunkResult> => {
      const ids = (chunk as number[][]).map(([i]) => i!);
      chunks.push(ids);
      return { lines: ids.map((i) => ({ ok: true as const, out: i, ms: ids.length === 1 ? (soloMs[i] ?? ms[i]!) : ms[i]! })), end: "ok", message: "" };
    };
    return { runChunk, chunks };
  };

  it("reports an input over its own limit as a timeout once it is over the limit alone too", async () => {
    const f = timed([10, 1500, 10]);
    const r = await runWithRestarts([[0], [1], [2]], f.runChunk, Infinity, 300);
    expect(r.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([0, "timeout", 2]);
    expect(f.chunks).toEqual([[0, 1, 2], [1]]);
  });

  it("keeps the input's result when it is within the limit alone (a slow moment, not a slow solution)", async () => {
    const f = timed([10, 1500, 10], { 1: 40 });
    const r = await runWithRestarts([[0], [1], [2]], f.runChunk, Infinity, 300);
    expect(r.outcomes).toEqual([
      { ok: true, out: 0, ms: 10 },
      { ok: true, out: 1, ms: 40 },
      { ok: true, out: 2, ms: 10 },
    ]);
  });

  it("checks the limit on a blamed input's solo run too", async () => {
    // The chunk times out at input 1; alone, input 1 finishes but still takes 900 ms of a 300 ms limit.
    const chunks: number[][] = [];
    const runChunk = async (chunk: unknown[][]): Promise<ChunkResult> => {
      const ids = (chunk as number[][]).map(([i]) => i!);
      chunks.push(ids);
      if (ids.length > 1) return { lines: [{ ok: true, out: ids[0], ms: 10 }], end: "timeout", message: "tle" };
      return { lines: [{ ok: true, out: ids[0], ms: ids[0] === 1 ? 900 : 10 }], end: "ok", message: "" };
    };
    const r = await runWithRestarts([[0], [1], [2]], runChunk, Infinity, 300);
    expect(r.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([0, "timeout", 2]);
  });

  it("does not re-run a lone input that is over the limit", async () => {
    const f = timed([900]);
    const r = await runWithRestarts([[0]], f.runChunk, Infinity, 300);
    expect(r.outcomes[0]).toMatchObject({ ok: false, error: "timeout" });
    expect(f.chunks).toHaveLength(1);
  });
});

describe("result size limit", () => {
  it("refuses a result line over the limit unread, and keeps later results aligned", () => {
    const huge = "[" + "1,".repeat(MAX_RESULT_CHARS / 2) + "1]";
    const out = parseLines(`\x1eCX{"ok":true,"out":${huge},"ms":1}\n\x1eCX{"ok":true,"out":7,"ms":1}\n`);
    expect(out[0]).toMatchObject({ ok: false, error: "runtime", message: expect.stringMatching(/^result too large/) });
    expect(out[1]).toEqual({ ok: true, out: 7, ms: 1 });
  });

  it("parses a large result within the limit quickly (the exact-integer reviver runs only when a long digit run is present)", () => {
    // Just under the limit: about 120,000 values in 240,000 characters.
    const n = Math.floor((MAX_RESULT_CHARS - 100) / 2);
    const big = "[" + "1,".repeat(n - 1) + "1]";
    const t0 = Date.now();
    const [o] = parseLines(`\x1eCX{"ok":true,"out":${big},"ms":1}\n`);
    expect(o?.ok && Array.isArray(o.out) && o.out.length).toBe(n);
    expect(Date.now() - t0).toBeLessThan(2000);
    const [b] = parseLines('\x1eCX{"ok":true,"out":[1,12345678901234567890],"ms":1}\n');
    expect(b?.ok && showValue(b.out)).toBe("[1,12345678901234567890]");
  });
});
