import type { TraceEvent } from "@/lib/agent/trace";
import { VERDICT, type ReportNoTrace } from "./format";
import { CUT_MESSAGE, type StreamMsg } from "./stream";

/**
 * The attack run's state machine, as a pure reducer (unit-tested). Every run
 * carries an id; only the run that owns the page (state.runId) may change it,
 * so a superseded or cancelled run's late messages are dropped.
 */

/** Client-side cap on one attack: the server's own deadline is 50 s and its maxDuration 60 s. */
export const CLIENT_TIMEOUT_MS = 75_000;
/** Abort reasons, so a run's failure can be told apart from a timeout. */
export const CANCELLED = "cancelled";
export const TIMED_OUT = "timed out";
export const CANCEL_NOTE = "Attack cancelled; the partial trace is shown.";
export const TIMEOUT_MESSAGE = `The attack took longer than ${CLIENT_TIMEOUT_MS / 1000} s, so it was stopped; the partial trace is shown.`;
/** Shown when the request failed before the server sent anything (offline, DNS, a reset). */
export const UNREACHABLE_MESSAGE = "Could not reach the server.";
/** Shown when the server sent an error line with no text. */
export const NO_DETAILS_MESSAGE = "The server reported an error without details.";

export type RunState = {
  /** The run that owns the page; 0 when none does. */
  runId: number;
  running: boolean;
  /** How many stream messages the run has received (a failed fetch with none means the server was never reached). */
  received: number;
  events: TraceEvent[];
  report: ReportNoTrace | null;
  executor: string;
  /** Why the run failed, shown as an alert (so it is not repeated in status). */
  error: string;
  /** A visible, non-error note (a cancelled run). */
  note: string;
  /** Text for the always-mounted live region: the verdict when a run ends, or why it stopped. */
  status: string;
};

/** How a run's fetch and stream ended: read to the end, or threw (abortReason is the signal's reason, if it was aborted). */
export type RunOutcome = { complete: boolean } | { thrown: unknown; abortReason?: unknown };

export type RunAction =
  | { type: "start"; runId: number }
  | { type: "msg"; runId: number; msg: StreamMsg }
  | { type: "finish"; runId: number; outcome: RunOutcome }
  /** The user pressed Cancel. */
  | { type: "cancel" }
  /** Another problem was picked: stop and clear. */
  | { type: "reset" };

export const initialRun: RunState = { runId: 0, running: false, received: 0, events: [], report: null, executor: "", error: "", note: "", status: "" };

/** Why a run threw, in words a user can act on: never a browser's raw "network error", "Failed to fetch" or an empty message. */
function failure(outcome: { thrown: unknown; abortReason?: unknown }, received: number): string {
  if (outcome.abortReason === TIMED_OUT) return TIMEOUT_MESSAGE;
  const t = outcome.thrown;
  // fetch() and a body read reject with a TypeError when the connection fails or is reset.
  if (t instanceof TypeError) return received > 0 ? CUT_MESSAGE : UNREACHABLE_MESSAGE;
  const text = t instanceof Error ? t.message : String(t);
  return text.trim() ? text : "The attack failed for an unknown reason.";
}

export function runReducer(s: RunState, a: RunAction): RunState {
  switch (a.type) {
    case "start":
      return { ...initialRun, runId: a.runId, running: true };
    case "reset":
      return initialRun;
    case "cancel":
      if (!s.runId) return s;
      return { ...s, runId: 0, running: false, note: CANCEL_NOTE, status: CANCEL_NOTE };
  }
  if (a.runId !== s.runId) return s;
  if (a.type === "msg") {
    const m = a.msg;
    const seen = { ...s, received: s.received + 1 };
    switch (m.type) {
      case "event":
        return { ...seen, events: [...s.events, m.event] };
      case "report":
        // Terminal: the run is over even if the connection lingers, so a later error, cancel or timeout cannot touch the report.
        return { ...seen, runId: 0, running: false, report: m.report, status: `${VERDICT[m.report.verdict]}. ${m.report.message}` };
      case "mode":
        return { ...seen, executor: m.executor };
      case "error":
        return { ...seen, error: m.error.trim() ? m.error : NO_DETAILS_MESSAGE };
      default:
        return seen;
    }
  }
  const done = { ...s, runId: 0, running: false };
  // The server's own error line says more than how the connection then ended.
  if (s.error) return done;
  if ("thrown" in a.outcome) {
    return { ...done, error: failure(a.outcome, s.received) };
  }
  if (!a.outcome.complete) return { ...done, error: CUT_MESSAGE };
  return done;
}
