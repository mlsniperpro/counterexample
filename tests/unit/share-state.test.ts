import { describe, expect, it } from "vitest";
import { initialShare, shareReducer, type ShareAction, type ShareState } from "@/app/share-state";
import { fullReport } from "../app-fixtures";

const play = (...actions: ShareAction[]): ShareState => actions.reduce(shareReducer, initialShare);
const report = fullReport();

describe("shareReducer (the shared-report banner)", () => {
  it("opens a report with its link as identity, and clears an earlier error", () => {
    const s = play({ type: "failed", message: "bad" }, { type: "opened", report, key: "#r=1.a" });
    expect(s).toEqual({ shared: report, key: "#r=1.a", error: "" });
  });

  it("drops the previously shown report when the next link cannot be opened, so the error is not shown beside a stale report", () => {
    const s = play({ type: "opened", report, key: "#r=1.a" }, { type: "failed", message: "not a report" });
    expect(s.shared).toBeNull();
    expect(s.error).toBe("Could not open the shared report: not a report");
  });

  it("clears both the report and the error when closed or when a run starts, and a new link then starts a fresh view", () => {
    const s = play({ type: "opened", report, key: "#r=1.a" }, { type: "failed", message: "x" }, { type: "clear" });
    expect(s).toMatchObject({ shared: null, error: "" });
    expect(play({ type: "opened", report, key: "#r=1.a" }, { type: "clear" }, { type: "opened", report, key: "#r=1.b" }).key).toBe("#r=1.b");
  });
});
