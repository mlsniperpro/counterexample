import { exactReviver } from "@/lib/core/compare";
import type { TraceEvent } from "@/lib/agent/trace";
import { VERDICT, type ReportNoTrace } from "./format";

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

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isNum = (x: unknown): x is number => typeof x === "number";
const allObj = (x: unknown, ok: (o: Obj) => boolean) => Array.isArray(x) && x.every((o) => isObj(o) && ok(o));
const optional = (x: unknown, ok: (v: unknown) => boolean) => x === undefined || ok(x);

const validEvent = (e: unknown) => isObj(e) && isNum(e.seq) && isNum(e.t) && isStr(e.stage) && isStr(e.kind) && isStr(e.msg) && optional(e.data, isObj);

/** The fields the UI reads from a report, checked so a malformed line cannot crash the page. */
function validReport(r: unknown): boolean {
  if (!isObj(r) || !Object.hasOwn(VERDICT, r.verdict as string) || !isStr(r.message)) return false;
  if (!isObj(r.problem) || !isStr(r.problem.id) || !isStr(r.problem.title)) return false;
  if (!isObj(r.solution) || !isStr(r.solution.code) || !isStr(r.solution.language)) return false;
  if (!isObj(r.setup) || !isObj(r.stats)) return false;
  const st = r.stats;
  if (![st.modelCalls, st.runs, st.inputsTested, st.costUsd, st.unpricedCalls].every(isNum) || !(st.timeToFirstCounterexampleMs === null || isNum(st.timeToFirstCounterexampleMs))) return false;
  if (!allObj(r.families, (f) => isStr(f.name) && isStr(f.rationale) && isNum(f.tested) && isNum(f.mismatches))) return false;
  const stageOk = (s: Obj) => isStr(s.purpose) && isStr(s.model) && isStr(s.why) && [s.calls, s.promptTokens, s.completionTokens, s.latencyMs].every(isNum) && (s.costUsd === null || isNum(s.costUsd));
  if (!allObj(r.stages, stageOk)) return false;
  if (!optional(r.trace, (t) => Array.isArray(t) && t.every(validEvent))) return false;
  if (!optional(r.explanation, isStr)) return false;
  const cx = r.counterexample;
  if (cx !== undefined) {
    if (!isObj(cx) || !Array.isArray(cx.args) || !isStr(cx.got) || !isNum(cx.shrinkSteps) || !isNum(cx.shrinkEvals)) return false;
    if (!isObj(cx.original) || !Array.isArray(cx.original.args) || !isStr(cx.original.family)) return false;
  }
  const fix = r.fix;
  if (fix !== undefined) {
    if (!isObj(fix) || !isStr(fix.code) || typeof fix.verified !== "boolean") return false;
    if (![fix.reattackInputs, fix.reattackMismatches, fix.reattackUnjudged].every(isNum)) return false;
  }
  const res = r.research;
  if (res !== undefined) {
    if (!isObj(res) || !allObj(res.facts, (f) => isStr(f.fact) && isStr(f.url))) return false;
    if (!Array.isArray(res.influencedFamilies) || !res.influencedFamilies.every(isStr)) return false;
  }
  return true;
}

/** Whether a parsed line has the shape of its message type; the UI reads these fields without checking. */
function validMsg(m: Obj): boolean {
  switch (m.type) {
    case "event":
      return validEvent(m.event);
    case "report":
      return validReport(m.report);
    case "mode":
      return isStr(m.executor);
    case "error":
      return isStr(m.error);
    default:
      return true; // a type this UI does not know: the reducer ignores it
  }
}

function parseLine(line: string): StreamMsg {
  let msg: unknown;
  try {
    // Big integers stay exact where the browser supports JSON.parse source text access.
    msg = JSON.parse(line, exactReviver);
  } catch {
    throw new Error(UNREADABLE_MESSAGE);
  }
  if (!isObj(msg) || !isStr(msg.type) || !validMsg(msg)) throw new Error(UNREADABLE_MESSAGE);
  return msg as StreamMsg;
}

/**
 * Read the attack stream line by line, handing each message to onMsg. A
 * stream that ends without a report or error line, or with a partial line
 * left in the buffer (the connection was cut mid-line), is reported as
 * incomplete instead of being silently dropped. A line that is not a message
 * throws UNREADABLE_MESSAGE. The report ends the read at once: a server that
 * then stalls without closing the connection cannot keep the run "attacking".
 * However it ends, the reader is cancelled, so a stream left half-read does
 * not keep the request (and the server's attack slot) open.
 */
export async function readAttackStream(body: ReadableStream<Uint8Array>, onMsg: (m: StreamMsg) => void): Promise<StreamEnd> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let terminal = false;
  /** Set once the report has arrived: the run is over, so a connection that stays open is closed rather than awaited. */
  let reported = false;
  const take = (line: string) => {
    if (!line.trim()) return;
    const msg = parseLine(line);
    if (msg.type === "report" || msg.type === "error") terminal = true;
    if (msg.type === "report") reported = true;
    onMsg(msg);
  };
  try {
    while (!reported) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while (!reported && (nl = buf.indexOf("\n")) >= 0) {
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
