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

  it("marks a simulated step's model with (replay) and says no model ran, but marks a live step with neither", () => {
    const stage = fullReport().stages[0]!;
    const replay = render(fullReport({ stages: [{ ...stage, simulated: true }] }));
    expect(replay).toContain("<code>u</code><span class=\"small muted\"> (replay)</span>");
    expect(replay).toContain("Replay mode: no model ran.");
    const live = render(fullReport({ stages: [{ ...stage, simulated: false }] }));
    expect(live).not.toContain("(replay)");
    expect(live).not.toContain("no model ran");
    // A mixed report marks only the simulated rows.
    const mixed = render(fullReport({ stages: [{ ...stage, simulated: true }, { ...stage, purpose: "explain", model: "nvidia/e", simulated: false }] }));
    expect(mixed.match(/\(replay\)/g)).toHaveLength(1);
  });

  it("names replay research a hand-written stand-in, and live research Tavily", () => {
    const research = { queries: ["q"], facts: [{ fact: "f", url: "https://example.com/" }], influencedFamilies: [] };
    const setup = fullReport().setup;
    const replay = render(fullReport({ research, setup: { ...setup, research: "replay" } }));
    expect(replay).toContain('<div class="label">Research (hand-written stand-in for Tavily)</div>');
    expect(replay).not.toContain("Research (Tavily)");
    const live = render(fullReport({ research, setup: { ...setup, research: "tavily" } }));
    expect(live).toContain('<div class="label">Research (Tavily)</div>');
    expect(live).not.toContain("hand-written stand-in for Tavily");
  });

  it("says how the re-attack of an unverified fix went, in the fix's colour", () => {
    const fix = { ...fullReport().fix!, verified: false, reattackInputs: 10, reattackMismatches: 0, reattackUnjudged: 0 };
    expect(render(fullReport({ fix }))).toContain('<span class="bad">no failure on 10 judged inputs, but the re-attack was incomplete</span>');
    const failing = render(fullReport({ fix: { ...fix, reattackMismatches: 2, reattackUnjudged: 3 } }));
    expect(failing).toContain('<span class="bad">still fails on 2 of 7 judged inputs (3 more the oracle could not judge)</span>');
    expect(render(fullReport({ fix: { ...fix, verified: true } }))).toContain('<span class="good">re-attacked on 10 judged inputs: 0 failures</span>');
  });

  it("counts unpriced model calls beside the cost, and only when there are some", () => {
    const stats = fullReport().stats;
    expect(render(fullReport({ stats: { ...stats, unpricedCalls: 1 } }))).toContain("<span>model cost (+1 unpriced)</span>");
    const none = render(fullReport({ stats: { ...stats, unpricedCalls: 0 } }));
    expect(none).toContain("<span>model cost</span>");
    expect(none).not.toContain("unpriced)");
  });

  it("marks simulated latency with * and explains it in a footnote; a live report has neither", () => {
    const stage = fullReport().stages[0]!;
    const sim = render(fullReport({ stages: [{ ...stage, latencyMs: 10, simulated: true }] }));
    expect(sim).toContain("10 ms*</td>");
    expect(sim).toMatch(/<p class="muted small">\* Replay mode: no model ran\..*latency is simulated\.<\/p>/);
    const live = render(fullReport({ stages: [{ ...stage, latencyMs: 10, simulated: false }] }));
    expect(live).toContain("10 ms</td>");
    expect(live).not.toContain("10 ms*");
    expect(live).not.toContain("Replay mode: no model ran");
  });

  it("shows a dash, not 0 ms, when no counterexample was found", () => {
    const stats = fullReport().stats;
    expect(render(fullReport({ stats: { ...stats, timeToFirstCounterexampleMs: null } }))).toContain("<b>–</b><span>to first counterexample</span>");
    expect(render(fullReport({ stats: { ...stats, timeToFirstCounterexampleMs: 0 } }))).toContain("<b>0 ms</b><span>to first counterexample</span>");
    expect(render(fullReport({ stats: { ...stats, timeToFirstCounterexampleMs: 2500 } }))).toContain("<b>2.5 s</b><span>to first counterexample</span>");
  });

  it("lists the generator families research shaped, and nothing when it shaped none", () => {
    const research = fullReport().research!;
    expect(render(fullReport({ research: { ...research, influencedFamilies: ["single-element", "big-sizes"] } }))).toContain("Shaped generator families: single-element, big-sizes");
    expect(render(fullReport({ research: { ...research, influencedFamilies: [] } }))).not.toContain("Shaped generator families");
  });

  it("says a counterexample may not be minimal when shrinking stopped early, and 'Minimal' otherwise", () => {
    const cx = fullReport().counterexample!;
    const early = render(fullReport({ counterexample: { ...cx, shrinkExhausted: true } }));
    expect(early).toContain("Counterexample (shrinking stopped early, may not be minimal)");
    expect(early).not.toContain(">Minimal counterexample<");
    const done = render(fullReport({ counterexample: { ...cx, shrinkExhausted: false } }));
    expect(done).toContain(">Minimal counterexample<");
    expect(done).not.toContain("may not be minimal");
  });
});
