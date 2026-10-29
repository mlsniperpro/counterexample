import { describe, expect, it } from "vitest";
import { fmtArgs } from "@/app/format";
import { fullReport, traceEvent } from "../app-fixtures";
import { readAttackStream, UNREADABLE_MESSAGE, type StreamMsg } from "@/app/stream";

/** A response body that delivers the given chunks, split wherever the test likes. */
const body = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(new TextEncoder().encode(s));
      c.close();
    },
  });

const read = async (...chunks: string[]) => {
  const msgs: StreamMsg[] = [];
  const end = await readAttackStream(body(...chunks), (m) => msgs.push(m));
  return { msgs, end };
};

const mode = JSON.stringify({ type: "mode", executor: "local" });
const event = JSON.stringify({ type: "event", event: { seq: 0, t: 0, stage: "run", kind: "info", msg: "hi" } });
const report = JSON.stringify({ type: "report", report: fullReport({ verdict: "no_counterexample" }) });

describe("readAttackStream (the UI's NDJSON reader)", () => {
  it("reads lines split across chunks and reports a finished run as complete", async () => {
    const all = `${mode}\n${event}\n\n${report}\n`;
    const { msgs, end } = await read(all.slice(0, 7), all.slice(7, 60), all.slice(60));
    expect(msgs.map((m) => m.type)).toEqual(["mode", "event", "report"]);
    expect(end.complete).toBe(true);
  });

  it("treats an error line as the end of the run", async () => {
    const { end } = await read(`${mode}\n${JSON.stringify({ type: "error", error: "boom" })}\n`);
    expect(end.complete).toBe(true);
  });

  it("stops reading at an error line: later lines are not delivered and a stream left open is cancelled", async () => {
    const { stream, seen } = (() => {
      const seen = { cancelled: false };
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(`${mode}\n${JSON.stringify({ type: "error", error: "boom" })}\n${event}\n${report}\n`));
        },
        cancel() {
          seen.cancelled = true;
        },
      });
      return { stream, seen };
    })();
    const msgs: StreamMsg[] = [];
    const end = await readAttackStream(stream, (m) => msgs.push(m));
    expect(msgs.map((m) => m.type)).toEqual(["mode", "error"]);
    expect(end.complete).toBe(false); // bytes were left after the terminal line
    expect(seen.cancelled).toBe(true);
  });

  it("flags a stream cut before any report or error line", async () => {
    const { msgs, end } = await read(`${mode}\n${event}\n`);
    expect(msgs).toHaveLength(2);
    expect(end.complete).toBe(false);
  });

  it("reports a final line cut mid-way as unreadable, after delivering the lines before it", async () => {
    const msgs: StreamMsg[] = [];
    await expect(readAttackStream(body(`${mode}\n${event}\n${report.slice(0, 20)}`), (m) => msgs.push(m))).rejects.toThrow(UNREADABLE_MESSAGE);
    expect(msgs.map((m) => m.type)).toEqual(["mode", "event"]);
  });

  it("parses a final line that has no trailing newline, so a complete report is not called a cut", async () => {
    const { msgs, end } = await read(`${mode}\n${report}`);
    expect(msgs.map((m) => m.type)).toEqual(["mode", "report"]);
    expect(end.complete).toBe(true);
    // Also when the line is split across chunks and ends in a multi-byte character.
    const err = JSON.stringify({ type: "error", error: "→ fail" });
    const bytes = new TextEncoder().encode(err);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, bytes.length - 3));
        c.enqueue(bytes.slice(bytes.length - 3));
        c.close();
      },
    });
    const got: StreamMsg[] = [];
    expect((await readAttackStream(stream, (m) => got.push(m))).complete).toBe(true);
    expect(got).toEqual([{ type: "error", error: "→ fail" }]);
    // A final line that is not a terminal message is delivered, and the run is still incomplete.
    const tail = await read(`${mode}\n${event}`);
    expect(tail.msgs.map((m) => m.type)).toEqual(["mode", "event"]);
    expect(tail.end.complete).toBe(false);
  });

  it("flags leftover bytes after the report line", async () => {
    expect((await read(`${report}\n{"type":"ev`)).end.complete).toBe(false);
  });

  it("decodes a multi-byte character split across chunks", async () => {
    const line = new TextEncoder().encode(`${JSON.stringify({ type: "error", error: "→ fail" })}\n`);
    const at = line.indexOf(0xe2) + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(line.slice(0, at));
        c.enqueue(line.slice(at));
        c.close();
      },
    });
    const msgs: StreamMsg[] = [];
    await readAttackStream(stream, (m) => msgs.push(m));
    expect(msgs).toEqual([{ type: "error", error: "→ fail" }]);
  });

  /** A body that stays open after its chunks, like a server still attacking, and records whether it was cancelled. */
  const open = (...chunks: string[]) => {
    const seen = { cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const s of chunks) c.enqueue(new TextEncoder().encode(s));
      },
      cancel() {
        seen.cancelled = true;
      },
    });
    return { stream, seen };
  };

  it("maps a line that is not JSON (a proxy's HTML page) to a readable error, and cancels the stream", async () => {
    const { stream, seen } = open(`${mode}\n<html><body>502 Bad Gateway</body></html>\n`);
    const msgs: StreamMsg[] = [];
    await expect(readAttackStream(stream, (m) => msgs.push(m))).rejects.toThrow(UNREADABLE_MESSAGE);
    expect(msgs.map((m) => m.type)).toEqual(["mode"]);
    expect(seen.cancelled).toBe(true);
  });

  it("treats JSON that is not a message as unreadable", async () => {
    for (const line of ["123", "null", '"text"', '{"no":"type"}']) {
      await expect(read(`${line}\n`)).rejects.toThrow(UNREADABLE_MESSAGE);
    }
  });

  it("cancels the stream when the message handler throws", async () => {
    const { stream, seen } = open(`${mode}\n`);
    await expect(
      readAttackStream(stream, () => {
        throw new Error("handler failed");
      }),
    ).rejects.toThrow("handler failed");
    expect(seen.cancelled).toBe(true);
  });

  describe("message shapes (a malformed line must not reach the UI)", () => {
    const bad = (m: unknown) => expect(read(`${JSON.stringify(m)}\n`)).rejects.toThrow(UNREADABLE_MESSAGE);
    const withReport = (over: Record<string, unknown>) => ({ type: "report", report: { ...fullReport(), ...over } });

    it("accepts a well-formed line of every type, with or without a trace", async () => {
      const ev = { type: "event", event: { ...traceEvent(1), data: { why: "w" } } };
      const lines = [mode, JSON.stringify(ev), JSON.stringify({ type: "report", report: { ...fullReport(), trace: [traceEvent(0)] } })];
      expect((await read(`${lines.join("\n")}\n`)).msgs.map((m) => m.type)).toEqual(["mode", "event", "report"]);
      expect((await read(`${report}\n`)).end.complete).toBe(true);
    });

    it("accepts a report from a real replay attack (the validator matches what the server sends)", async () => {
      const { attack } = await import("@/lib/agent/run");
      const { makeDeps } = await import("@/lib/agent/setup");
      const { BUILT_INS } = await import("@/lib/problems/catalog");
      const b = BUILT_INS.find((x) => x.problem.id === "binary-search")!;
      const { trace, ...rest } = await attack({ problem: b.problem, solution: b.demo, research: "force" }, makeDeps({ mode: "replay", env: { NODE_ENV: "test" } }));
      expect((await read(`${JSON.stringify({ type: "report", report: rest })}\n`)).end.complete).toBe(true);
      expect((await read(`${JSON.stringify({ type: "report", report: { ...rest, trace } })}\n`)).end.complete).toBe(true);
    });

    it("rejects an event missing seq, t, stage, kind or msg, or with a wrong type for any of them", async () => {
      const e = traceEvent(0);
      for (const key of ["seq", "t", "stage", "kind", "msg"] as const) {
        const { [key]: _drop, ...without } = e;
        void _drop;
        await bad({ type: "event", event: without });
        await bad({ type: "event", event: { ...e, [key]: key === "seq" || key === "t" ? "1" : 7 } });
      }
      await bad({ type: "event" });
      await bad({ type: "event", event: null });
      await bad({ type: "event", event: [] });
      await bad({ type: "event", event: { ...e, data: "text" } });
    });

    it("rejects a report with an unknown verdict, a non-string message, or without families, stages, stats or problem", async () => {
      await bad({ type: "report" });
      await bad({ type: "report", report: null });
      await bad(withReport({ verdict: "maybe" }));
      await bad(withReport({ verdict: "toString" })); // an inherited property is not a verdict
      await bad(withReport({ message: 7 }));
      for (const key of ["families", "stages", "stats", "problem", "solution", "setup"]) await bad(withReport({ [key]: undefined }));
      await bad(withReport({ families: {} }));
      await bad(withReport({ stages: "none" }));
      await bad(withReport({ stats: [] }));
      await bad(withReport({ stats: { ...fullReport().stats, inputsTested: "3" } }));
      await bad(withReport({ trace: {} }));
      await bad(withReport({ trace: [{ seq: 0 }] }));
    });

    it("rejects a report whose families, stages or optional sections have the wrong shape", async () => {
      await bad(withReport({ families: [{ name: "f" }] }));
      await bad(withReport({ families: [null] }));
      await bad(withReport({ stages: [{ ...fullReport().stages[0], model: 5 }] }));
      await bad(withReport({ stages: [{ ...fullReport().stages[0], latencyMs: "10" }] }));
      await bad(withReport({ explanation: 5 }));
      await bad(withReport({ counterexample: { ...fullReport().counterexample, args: "x" } }));
      await bad(withReport({ counterexample: { ...fullReport().counterexample, original: {} } }));
      await bad(withReport({ counterexample: "x" }));
      await bad(withReport({ fix: { ...fullReport().fix, code: 1 } }));
      await bad(withReport({ fix: { ...fullReport().fix, verified: "yes" } }));
      await bad(withReport({ research: { ...fullReport().research, facts: "none" } }));
      await bad(withReport({ research: { ...fullReport().research, facts: [{ fact: "f" }] } }));
      await bad(withReport({ research: { ...fullReport().research, influencedFamilies: [1] } }));
    });

    it("rejects a research event whose facts are not {fact, url} strings, and accepts one that is", async () => {
      const research = (data: unknown) => ({ type: "event", event: { ...traceEvent(0), kind: "research", data } });
      await bad(research({ facts: [null] }));
      await bad(research({ facts: ["text"] }));
      await bad(research({ facts: [{ fact: "f" }] }));
      await bad(research({ facts: [{ fact: 1, url: "u" }] }));
      await bad(research({ facts: {} }));
      const ok = research({ facts: [{ fact: "f", url: "https://example.com" }] });
      expect((await read(`${JSON.stringify(ok)}\n`)).msgs).toHaveLength(1);
      expect((await read(`${JSON.stringify(research({ queries: ["q"] }))}\n`)).msgs).toHaveLength(1);
    });

    it("rejects a mode line without a string executor, and an error line without string text", async () => {
      await bad({ type: "mode" });
      await bad({ type: "mode", executor: 3 });
      await bad({ type: "error" });
      await bad({ type: "error", error: 3 });
      await bad({ type: "error", error: { message: "x" } });
      await bad({ type: "error", error: null });
    });

    it("ignores a message type it does not know instead of failing the run", async () => {
      const { msgs } = await read(`${JSON.stringify({ type: "future", x: 1 })}\n${mode}\n`);
      expect(msgs.map((m) => m.type)).toEqual(["future", "mode"]);
    });
  });

  it("keeps integers above 2^53 exact (they would otherwise display rounded)", async () => {
    // JSON.stringify cannot write these, so the digits are spliced into the text as a server's showValue would.
    const text = JSON.stringify({ type: "report", report: fullReport({ counterexample: { ...fullReport().counterexample!, args: ["BIG", ["NEG"]], original: { args: ["BIG"], family: "f" } } }) }).replaceAll('"BIG"', "9007199254740993").replaceAll('"NEG"', "-9223372036854775807");
    const { msgs } = await read(`${text}\n`);
    const cx = (msgs[0] as Extract<StreamMsg, { type: "report" }>).report.counterexample!;
    expect(fmtArgs(cx.args)).toBe("9007199254740993, [-9223372036854775807]");
    expect(fmtArgs(cx.original.args)).toBe("9007199254740993");
    expect(fmtArgs(cx.args)).not.toMatch(/int:|\\u0000/);
  });

  it("stops reading at the report: a connection left open afterwards is cancelled, not awaited", async () => {
    const { stream, seen } = open(`${mode}\n${report}\n`);
    const msgs: StreamMsg[] = [];
    const end = await readAttackStream(stream, (m) => msgs.push(m));
    expect(end.complete).toBe(true);
    expect(msgs.map((m) => m.type)).toEqual(["mode", "report"]);
    expect(seen.cancelled).toBe(true);
  });
});
