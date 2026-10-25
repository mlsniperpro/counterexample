import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@/lib/agent/trace";
import type { ReportNoTrace } from "@/app/format";
import { CANCEL_NOTE, CANCELLED, initialRun, runReducer, TIMED_OUT, TIMEOUT_MESSAGE, type RunAction, type RunState } from "@/app/run-state";
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
    const before = play({ type: "start", runId: 1 }, msg(1, { type: "event", event: ev(0) }), msg(1, { type: "report", report }), { type: "finish", runId: 1, outcome: { complete: false } });
    expect(before.error).toBe(CUT_MESSAGE);
    expect(runReducer(before, { type: "start", runId: 2 })).toEqual({ ...initialRun, runId: 2, running: true });
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
});
