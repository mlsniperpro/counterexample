import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@/lib/agent/trace";
import type { ReportNoTrace } from "@/app/format";
import { CANCEL_NOTE, CANCELLED, focusIsIdle, initialRun, NO_DETAILS_MESSAGE, runReducer, START_NOTE, TIMED_OUT, TIMEOUT_MESSAGE, UNREACHABLE_MESSAGE, type RunAction, type RunState } from "@/app/run-state";
import { CUT_MESSAGE, type StreamMsg } from "@/app/stream";

const ev = (seq: number): TraceEvent => ({ seq, t: seq, stage: "run", kind: "info", msg: `e${seq}` }) as TraceEvent;
const report = { verdict: "no_counterexample", message: "0 mismatches." } as ReportNoTrace;
const msg = (runId: number, m: StreamMsg): RunAction => ({ type: "msg", runId, msg: m });
const play = (...actions: RunAction[]): RunState => actions.reduce(runReducer, initialRun);
const abortError = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

describe("runReducer (the attack run's state machine)", () => {
  it("starts a run with a clean page and records its messages", () => {
    const s = play(
      { type: "start", runId: 1 },
      msg(1, { type: "mode", executor: "local" }),
      msg(1, { type: "event", event: ev(0) }),
      msg(1, { type: "event", event: ev(1) }),
      msg(1, { type: "report", report }),
      { type: "finish", runId: 1, outcome: { complete: true } },
    );
    expect(s).toMatchObject({ runId: 0, running: false, executor: "local", report, error: "", note: "" });
    expect(s.events.map((e) => e.seq)).toEqual([0, 1]);
    expect(s.status).toBe("Survived the attack. 0 mismatches.");
  });

  it("clears the previous run's trace, report and messages on start", () => {
    const before = play({ type: "start", runId: 1 }, msg(1, { type: "event", event: ev(0) }), msg(1, { type: "report", report }));
    expect(before).toMatchObject({ report, error: "" });
    expect(before.events).toHaveLength(1);
    expect(runReducer(before, { type: "start", runId: 2 })).toEqual({ ...initialRun, runId: 2, running: true, status: START_NOTE });
    const failed = play({ type: "start", runId: 1 }, msg(1, { type: "event", event: ev(0) }), { type: "finish", runId: 1, outcome: { complete: false } });
    expect(failed.error).toBe(CUT_MESSAGE);
    expect(runReducer(failed, { type: "start", runId: 2 })).toEqual({ ...initialRun, runId: 2, running: true, status: START_NOTE });
  });

  it("ignores every message and the finish of a superseded run", () => {
    const s = play(
      { type: "start", runId: 1 },
      msg(1, { type: "event", event: ev(0) }),
      { type: "start", runId: 2 },
      msg(1, { type: "event", event: ev(99) }),
      msg(1, { type: "report", report }),
      msg(1, { type: "mode", executor: "stale" }),
      msg(1, { type: "error", error: "stale error" }),
      { type: "finish", runId: 1, outcome: { thrown: abortError() } },
      msg(2, { type: "event", event: ev(5) }),
    );
    expect(s).toMatchObject({ runId: 2, running: true, report: null, executor: "", error: "" });
    expect(s.events.map((e) => e.seq)).toEqual([5]);
  });

  it("sets the cut message when the stream ends before the server finished", () => {
    const s = play({ type: "start", runId: 1 }, msg(1, { type: "event", event: ev(0) }), { type: "finish", runId: 1, outcome: { complete: false } });
    expect(s).toMatchObject({ running: false, error: CUT_MESSAGE });
    expect(s.events).toHaveLength(1);
  });

  it("sets the timeout message when the client deadline aborted the run", () => {
    const s = play({ type: "start", runId: 1 }, msg(1, { type: "event", event: ev(0) }), { type: "finish", runId: 1, outcome: { thrown: abortError(), abortReason: TIMED_OUT } });
    expect(s).toMatchObject({ running: false, error: TIMEOUT_MESSAGE, note: "" });
    expect(s.events).toHaveLength(1);
  });

  it("shows a thrown error's message, and the server's error line", () => {
    expect(play({ type: "start", runId: 1 }, { type: "finish", runId: 1, outcome: { thrown: new Error("Too many attacks") } }).error).toBe("Too many attacks");
    expect(play({ type: "start", runId: 1 }, { type: "finish", runId: 1, outcome: { thrown: "odd" } }).error).toBe("odd");
    const s = play({ type: "start", runId: 1 }, msg(1, { type: "error", error: "boom" }), { type: "finish", runId: 1, outcome: { complete: true } });
    expect(s).toMatchObject({ running: false, error: "boom" });
  });

  it("on cancel, stops at once, keeps the partial trace, shows the note, and drops the run's late messages", () => {
    const s = play(
      { type: "start", runId: 1 },
      msg(1, { type: "event", event: ev(0) }),
      { type: "cancel" },
      msg(1, { type: "event", event: ev(1) }),
      { type: "finish", runId: 1, outcome: { thrown: abortError(), abortReason: CANCELLED } },
    );
    expect(s).toMatchObject({ runId: 0, running: false, error: "", note: CANCEL_NOTE, status: CANCEL_NOTE });
    expect(s.events.map((e) => e.seq)).toEqual([0]);
  });

  it("does nothing on cancel with no run in flight", () => {
    const done = play({ type: "start", runId: 1 }, msg(1, { type: "report", report }), { type: "finish", runId: 1, outcome: { complete: true } });
    expect(runReducer(done, { type: "cancel" })).toBe(done);
  });

  it("clears everything on reset, and the reset run cannot write afterwards", () => {
    const s = play({ type: "start", runId: 1 }, msg(1, { type: "event", event: ev(0) }), { type: "reset" }, msg(1, { type: "event", event: ev(1) }), {
      type: "finish",
      runId: 1,
      outcome: { complete: false },
    });
    expect(s).toEqual(initialRun);
  });

  it("maps a TypeError (a reset or failed connection) to the cut message after a message arrived, and to 'could not reach' before any", () => {
    const reset = { thrown: new TypeError("network error") };
    const before = play({ type: "start", runId: 1 }, { type: "finish", runId: 1, outcome: reset });
    expect(before).toMatchObject({ running: false, error: UNREACHABLE_MESSAGE });
    const fetchFail = play({ type: "start", runId: 1 }, { type: "finish", runId: 1, outcome: { thrown: new TypeError("Failed to fetch") } });
    expect(fetchFail.error).toBe(UNREACHABLE_MESSAGE);
    for (const first of [msg(1, { type: "mode", executor: "local" }), msg(1, { type: "event", event: ev(0) })]) {
      const after = play({ type: "start", runId: 1 }, first, { type: "finish", runId: 1, outcome: reset });
      expect(after.error, first.type).toBe(CUT_MESSAGE);
    }
    // A timeout still wins over the TypeError a torn-down fetch can throw.
    const timed = play({ type: "start", runId: 1 }, { type: "finish", runId: 1, outcome: { thrown: new TypeError("x"), abortReason: TIMED_OUT } });
    expect(timed.error).toBe(TIMEOUT_MESSAGE);
  });

  it("never shows an empty error: an error line or thrown error without text gets a readable one", () => {
    expect(play({ type: "start", runId: 1 }, msg(1, { type: "error", error: "" })).error).toBe(NO_DETAILS_MESSAGE);
    expect(play({ type: "start", runId: 1 }, msg(1, { type: "error", error: "  " })).error).toBe(NO_DETAILS_MESSAGE);
    const thrown = play({ type: "start", runId: 1 }, { type: "finish", runId: 1, outcome: { thrown: new Error("") } });
    expect(thrown.error).not.toBe("");
  });

  it("treats the report as terminal: running stops, and a later error, timeout, cut or cancel cannot touch the report", () => {
    const done = play({ type: "start", runId: 1 }, msg(1, { type: "event", event: ev(0) }), msg(1, { type: "report", report }));
    expect(done).toMatchObject({ runId: 0, running: false, report, error: "", note: "", status: "Survived the attack. 0 mismatches." });
    const after = [
      msg(1, { type: "error", error: "late error" }),
      msg(1, { type: "event", event: ev(9) }),
      { type: "finish", runId: 1, outcome: { thrown: abortError(), abortReason: TIMED_OUT } },
      { type: "finish", runId: 1, outcome: { thrown: new TypeError("network error") } },
      { type: "finish", runId: 1, outcome: { complete: false } },
      { type: "cancel" },
    ] satisfies RunAction[];
    for (const a of after) expect(runReducer(done, a), a.type).toBe(done);
    expect(done.events).toHaveLength(1);
  });

  it("keeps the server's error line when the stream's ending is then reported as a cut, a timeout or a dropped connection", () => {
    const withError = [{ type: "start", runId: 1 }, msg(1, { type: "error", error: "Too many attacks" })] satisfies RunAction[];
    const outcomes = [{ complete: false }, { complete: true }, { thrown: new TypeError("network error") }, { thrown: abortError(), abortReason: TIMED_OUT }] as const;
    for (const outcome of outcomes) {
      const s = play(...withError, { type: "finish", runId: 1, outcome });
      expect(s, JSON.stringify(outcome)).toMatchObject({ running: false, runId: 0, error: "Too many attacks" });
    }
  });
});

describe("focus when a run ends", () => {
  const el = (tagName: string) => ({ tagName });
  it("moves to the Attack button only from nowhere, <body> or the Cancel button", () => {
    const cancel = el("BUTTON");
    expect(focusIsIdle(null, cancel)).toBe(true);
    expect(focusIsIdle(el("BODY"), cancel)).toBe(true);
    expect(focusIsIdle(cancel, cancel)).toBe(true);
    // The reader moved focus during the run: it stays there.
    expect(focusIsIdle(el("TEXTAREA"), cancel)).toBe(false);
    expect(focusIsIdle(el("BUTTON"), cancel)).toBe(false);
    expect(focusIsIdle(el("BUTTON"), null)).toBe(false);
  });

  it("announces a start, and drops that note when the run ends without a verdict, so a retry is announced again", () => {
    expect(START_NOTE).toBe("Attack started. The verdict will be announced when it is ready.");
    const started = runReducer(initialRun, { type: "start", runId: 1 });
    expect(started.status).toBe(START_NOTE);
    const failed = runReducer(started, { type: "finish", runId: 1, outcome: { thrown: new TypeError("fetch failed") } });
    expect(failed.status).toBe("");
    expect(failed.error).not.toBe("");
    const errored = play({ type: "start", runId: 2 }, msg(2, { type: "error", error: "Sandbox exploded" }), { type: "finish", runId: 2, outcome: { complete: true } });
    expect(errored.status).toBe("");
    const cut = play({ type: "start", runId: 3 }, { type: "finish", runId: 3, outcome: { complete: false } });
    expect(cut.status).toBe("");
  });
});
