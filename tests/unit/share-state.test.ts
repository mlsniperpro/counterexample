import { describe, expect, it } from "vitest";
import { initialShare, shareReducer, type ShareAction, type ShareState } from "@/app/share-state";
import { fullReport } from "../app-fixtures";

const play = (...actions: ShareAction[]): ShareState => actions.reduce(shareReducer, initialShare);
const report = fullReport();
const decoding = (key: string): ShareAction => ({ type: "decoding", key });

describe("shareReducer (the shared-report banner)", () => {
  it("opens a report with its link as identity, and clears an earlier error", () => {
    const s = play(decoding("#r=1.x"), { type: "failed", message: "bad", key: "#r=1.x" }, decoding("#r=1.a"), { type: "opened", report, key: "#r=1.a" });
    expect(s).toEqual({ shared: report, key: "#r=1.a", error: "", pending: "", failures: 1 });
  });

  it("counts failures, so a second bad link with the same message is a new error to show and announce", () => {
    const once = play(decoding("#r=1.x"), { type: "failed", message: "damaged", key: "#r=1.x" });
    const twice = play(decoding("#r=1.x"), { type: "failed", message: "damaged", key: "#r=1.x" }, decoding("#r=1.y"), { type: "failed", message: "damaged", key: "#r=1.y" });
    expect(twice.error).toBe(once.error);
    expect(twice.failures).toBe(once.failures + 1);
  });

  it("drops the previously shown report when the next link cannot be opened, so the error is not shown beside a stale report", () => {
    const s = play(decoding("#r=1.a"), { type: "opened", report, key: "#r=1.a" }, decoding("#r=1.b"), { type: "failed", message: "not a report", key: "#r=1.b" });
    expect(s.shared).toBeNull();
    expect(s.error).toBe("Could not open the shared report: not a report");
  });

  it("clears both the report and the error when closed or when a run starts, and a new link then starts a fresh view", () => {
    const s = play(decoding("#r=1.a"), { type: "opened", report, key: "#r=1.a" }, decoding("#r=1.b"), { type: "failed", message: "x", key: "#r=1.b" }, { type: "clear" });
    expect(s).toMatchObject({ shared: null, error: "" });
    expect(play(decoding("#r=1.a"), { type: "opened", report, key: "#r=1.a" }, { type: "clear" }, decoding("#r=1.b"), { type: "opened", report, key: "#r=1.b" }).key).toBe("#r=1.b");
  });

  it("ignores a decode that finishes after a run started (the run cleared it), and one for a link that is no longer the latest", () => {
    // Link set, Attack pressed before the decode resolved: the run must not be covered by the late report.
    expect(play(decoding("#r=1.a"), { type: "clear" }, { type: "opened", report, key: "#r=1.a" })).toEqual(initialShare);
    expect(play(decoding("#r=1.a"), { type: "clear" }, { type: "failed", message: "x", key: "#r=1.a" })).toEqual(initialShare);
    // Two links in a row: only the second one's result counts, whichever finishes first.
    const s = play(decoding("#r=1.a"), decoding("#r=1.b"), { type: "opened", report, key: "#r=1.b" }, { type: "opened", report: fullReport({ problem: { ...report.problem, title: "Other" } }), key: "#r=1.a" });
    expect(s.key).toBe("#r=1.b");
    expect(s.shared).toBe(report);
  });
});
