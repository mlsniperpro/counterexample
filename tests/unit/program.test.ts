import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildProgram, parseLines, reachedReady, runWithRestarts } from "@/lib/exec/program";
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
    const r = await runWithRestarts([[0], [1], [2], [3]], f.runChunk, Infinity, true);
    expect(r.outcomes).toEqual([0, 1, 2, 3].map((i) => ({ ok: true, out: i, ms: 0 })));
    expect(f.chunks).toEqual([[0, 1, 2, 3], [2], [3]]);
    expect(r.processes).toBe(3);
  });

  it("still blames an input that times out on its own", async () => {
    const f = sharedBudget([1, 50, 1], 10);
    const r = await runWithRestarts([[0], [1], [2]], f.runChunk, Infinity, true);
    expect(r.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([0, "timeout", 2]);
    expect(f.chunks).toEqual([[0, 1, 2], [1], [2]]);
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
