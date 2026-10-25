import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReportView from "@/app/report-view";
import { fullReport } from "../app-fixtures";

const render = (r = fullReport(), extra: { shareNote?: string; shareLink?: string } = {}) => renderToStaticMarkup(createElement(ReportView, { r, onCopy: () => {}, onShare: () => {}, ...extra }));
const statusRegions = (html: string) => [...html.matchAll(/<p[^>]*role="status"[^>]*>(.*?)<\/p>/g)].map((m) => m[1]);

describe("ReportView markup", () => {
  it("keeps both note live regions mounted while empty, so a later note is announced", () => {
    expect(statusRegions(render())).toEqual(["", ""]);
    expect(statusRegions(render(fullReport(), { shareNote: "Link copied." }))).toEqual(["Link copied.", ""]);
  });

  it("tells screen readers which diff lines were added and which removed", () => {
    const html = render(fullReport({ solution: { language: "python", code: "def solve(a, t):\n    return -1\n", entry: "solve" } }));
    expect(html).toMatch(/<div class="dl del"><span class="sign" aria-hidden="true">-<\/span><span class="sr-only">removed: <\/span>/);
    expect(html).toMatch(/<div class="dl add"><span class="sign" aria-hidden="true">\+<\/span><span class="sr-only">added: <\/span>/);
    // Unchanged lines carry no label.
    expect(html).toContain('<div class="dl same"><span class="sign" aria-hidden="true"> </span>def solve(a, t):</div>');
  });

  it("cuts the original arguments at 120 characters with an ellipsis", () => {
    const long = Array.from({ length: 60 }, (_, i) => 1000 + i);
    const cx = fullReport().counterexample!;
    const html = render(fullReport({ counterexample: { ...cx, original: { args: [long], family: "f" } } }));
    const shown = html.match(/Shrunk from <code>(.*?)<\/code>/)![1]!;
    expect(shown.endsWith("…")).toBe(true);
    expect(shown).toHaveLength(121);
    const short = render(fullReport({ counterexample: { ...cx, original: { args: [[1, 2]], family: "f" } } }));
    expect(short).toContain("Shrunk from <code>[1,2]</code>");
  });
});
