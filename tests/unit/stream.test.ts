import { describe, expect, it } from "vitest";
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
const report = JSON.stringify({ type: "report", report: { verdict: "no_counterexample" } });

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

  it("flags a stream cut before any report or error line", async () => {
    const { msgs, end } = await read(`${mode}\n${event}\n`);
    expect(msgs).toHaveLength(2);
    expect(end.complete).toBe(false);
  });

  it("flags a stream cut mid-line instead of silently dropping the partial line", async () => {
    const { msgs, end } = await read(`${mode}\n${event}\n${report.slice(0, 20)}`);
    expect(msgs.map((m) => m.type)).toEqual(["mode", "event"]);
    expect(end.complete).toBe(false);
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
});
