import type { SharedReport } from "@/lib/share";

/** The shared-report banner's state, as a pure reducer (unit-tested): the report opened from a link, which link it was, and why a link could not be opened. */
export type ShareState = {
  shared: SharedReport | null;
  /** The link the shared report came from: its identity, so a second link starts a fresh ReportView (no stale "Copied" note or open full fix). */
  key: string;
  /** Why a share link could not be opened; shown at the top, where the shared report would be. */
  error: string;
};

export type ShareAction =
  | { type: "opened"; report: SharedReport; key: string }
  /** The link could not be decoded: no report is shown, and the old one must not stay next to the error. */
  | { type: "failed"; message: string }
  /** Closed, or the page now shows something else (a run started). */
  | { type: "clear" };

export const initialShare: ShareState = { shared: null, key: "", error: "" };

export function shareReducer(s: ShareState, a: ShareAction): ShareState {
  switch (a.type) {
    case "opened":
      return { shared: a.report, key: a.key, error: "" };
    case "failed":
      return { ...s, shared: null, error: `Could not open the shared report: ${a.message}` };
    case "clear":
      return { ...s, shared: null, error: "" };
  }
}
