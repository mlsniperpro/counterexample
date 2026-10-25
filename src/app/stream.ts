import { exactReviver } from "@/lib/core/compare";
import type { TraceEvent } from "@/lib/agent/trace";
import type { ReportNoTrace } from "./format";

/** One line of the /api/attack NDJSON stream. */
export type StreamMsg =
  | { type: "event"; event: TraceEvent }
  | { type: "report"; report: ReportNoTrace }
  | { type: "mode"; executor: string }
  | { type: "error"; error: string };

export type StreamEnd = {
  /** A report or error line arrived and nothing was left over: the server finished. */
  complete: boolean;
};

/** Shown when the stream stops before the server said it was done. */
export const CUT_MESSAGE = "The connection ended before the attack finished; the partial trace is shown.";

/** Shown when a line is not one of ours, e.g. an HTML error page a proxy put in the stream. */
export const UNREADABLE_MESSAGE = "The server sent an unreadable response.";

function parseLine(line: string): StreamMsg {
  let msg: unknown;
  try {
    // Big integers stay exact where the browser supports JSON.parse source text access.
    msg = JSON.parse(line, exactReviver);
  } catch {
    throw new Error(UNREADABLE_MESSAGE);
  }
  if (typeof msg !== "object" || msg === null || typeof (msg as { type?: unknown }).type !== "string") throw new Error(UNREADABLE_MESSAGE);
  return msg as StreamMsg;
}

/**
 * Read the attack stream line by line, handing each message to onMsg. A
 * stream that ends without a report or error line, or with a partial line
 * left in the buffer (the connection was cut mid-line), is reported as
 * incomplete instead of being silently dropped. A line that is not a message
 * throws UNREADABLE_MESSAGE. However it ends, the reader is cancelled, so a
 * stream left half-read does not keep the request (and the server's attack
 * slot) open.
 */
export async function readAttackStream(body: ReadableStream<Uint8Array>, onMsg: (m: StreamMsg) => void): Promise<StreamEnd> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let terminal = false;
  const take = (line: string) => {
    if (!line.trim()) return;
    const msg = parseLine(line);
    if (msg.type === "report" || msg.type === "error") terminal = true;
    onMsg(msg);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        take(line);
      }
    }
  } finally {
    // A no-op on a finished stream; on an early exit (a bad line, a throwing onMsg) it stops the download.
    await reader.cancel().catch(() => {});
  }
  buf += dec.decode();
  return { complete: terminal && !buf.trim() };
}
