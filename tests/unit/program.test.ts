import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildProgram, parseLines, reachedReady, runWithRestarts } from "@/lib/exec/program";
import type { ChunkResult, RunOutcome } from "@/lib/exec/types";

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
