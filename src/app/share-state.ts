import type { SharedReport } from "@/lib/share";

/** The shared-report banner's state, as a pure reducer (unit-tested): the report opened from a link, which link it was, and why a link could not be opened. */
export type ShareState = {
  shared: SharedReport | null;
  /** The link the shared report came from: its identity, so a second link starts a fresh ReportView (no stale "Copied" note or open full fix). */
  key: string;
  /** Why a share link could not be opened; shown at the top, where the shared report would be. */
  error: string;
  /** The link being decoded, if any. Decoding is async: a result for any other link (one cleared by a run that started meanwhile) is dropped. */
  pending: string;
};

export type ShareAction =
  /** A link starts decoding. */
  | { type: "decoding"; key: string }
  | { type: "opened"; report: SharedReport; key: string }
  /** The link could not be decoded: no report is shown, and the old one must not stay next to the error. */
  | { type: "failed"; message: string; key: string }
  /** Closed, or the page now shows something else (a run started). */
  | { type: "clear" };

export const initialShare: ShareState = { shared: null, key: "", error: "", pending: "" };

export function shareReducer(s: ShareState, a: ShareAction): ShareState {
  switch (a.type) {
    case "decoding":
      return { ...s, pending: a.key };
    case "opened":
      return a.key === s.pending ? { shared: a.report, key: a.key, error: "", pending: "" } : s;
    case "failed":
      return a.key === s.pending ? { ...s, shared: null, error: `Could not open the shared report: ${a.message}`, pending: "" } : s;
    case "clear":
      return { ...s, shared: null, error: "", pending: "" };
  }
}
