import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReportView from "@/app/report-view";
import { toMarkdown } from "@/app/format";
import { fullReport } from "../app-fixtures";

const render = (r = fullReport(), extra: { shareNote?: string; shareLink?: string } = {}) => renderToStaticMarkup(createElement(ReportView, { r, onCopy: () => {}, onShare: () => {}, ...extra }));
const statusRegions = (html: string) => [...html.matchAll(/<p[^>]*role="status"[^>]*>(.*?)<\/p>/g)].map((m) => m[1]);

describe("ReportView markup", () => {
  it("keeps both note live regions mounted while empty, so a later note is announced", () => {
    // Each note sits in a span inside its region: the span is replaced for every note, so an identical one is announced again.
    expect(statusRegions(render())).toEqual(["<span></span>", "<span></span>"]);
    expect(statusRegions(render(fullReport(), { shareNote: "Link copied." }))).toEqual(["<span>Link copied.</span>", "<span></span>"]);
  });

  it("tells screen readers which diff lines were added and which removed", () => {
    const html = render(fullReport({ solution: { language: "python", code: "def solve(a, t):\n    return -1\n", entry: "solve" } }));
    expect(html).toMatch(/<div class="dl del"><span class="sign" aria-hidden="true">-<\/span><span class="sr-only">removed: <\/span>/);
    expect(html).toMatch(/<div class="dl add"><span class="sign" aria-hidden="true">\+<\/span><span class="sr-only">added: <\/span>/);
    // The removed line is the submitted code and the added line is the fix, not the other way round.
    expect(html).toContain('<div class="dl del"><span class="sign" aria-hidden="true">-</span><span class="sr-only">removed: </span>    return -1</div>');
    expect(html).toContain('<div class="dl add"><span class="sign" aria-hidden="true">+</span><span class="sr-only">added: </span>    return 0</div>');
    // Unchanged lines carry no label.
    expect(html).toContain('<div class="dl same"><span class="sign" aria-hidden="true"> </span>def solve(a, t):</div>');
  });

  it("counts changed lines in the singular and the plural", () => {
    // The fixture's fix is "def solve(a, t):\n    return 0\n": one added line, then a replaced one (two changed lines).
    expect(render(fullReport({ solution: { language: "python", code: "def solve(a, t):\n", entry: "solve" } }))).toContain("1 changed line against your code");
    expect(render(fullReport({ solution: { language: "python", code: "def solve(a, t):\n    return -1\n", entry: "solve" } }))).toContain("2 changed lines against your code");
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
    expect(replay).toContain('<h3 class="label">Research (hand-written stand-in for Tavily)</h3>');
    expect(replay).not.toContain("Research (Tavily)");
    const live = render(fullReport({ research, setup: { ...setup, research: "tavily" } }));
    expect(live).toContain('<h3 class="label">Research (Tavily)</h3>');
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
    expect(sim).toMatch(/<p class="muted small">\* Replay mode: no model ran\..*latency is simulated \(the time to first counterexample includes it\)\.<\/p>/);
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

describe("ReportView research section", () => {
  it("says when research did not complete, and when it found nothing, instead of an empty section", () => {
    const base = fullReport();
    const failed = render({ ...base, research: { queries: ["q"], facts: [], influencedFamilies: [], error: "no research client configured (set TAVILY_API_KEY)" } });
    expect(failed).toContain("Research did not complete: no research client configured (set TAVILY_API_KEY)");
    const empty = render({ ...base, research: { queries: ["q"], facts: [], influencedFamilies: [] } });
    expect(empty).toContain("The searches found no facts to use.");
  });
});

describe("ReportView content (each number and text in its place)", () => {
  const r = fullReport({
    families: [{ name: "single-element", rationale: "One element.", citations: [], source: "model", generated: 7, dropped: 0, tested: 4, mismatches: 1, oracleSkipped: 0 }],
    stages: [{ stage: "oracle", purpose: "oracle", role: "reasoning", model: "nvidia/u", why: "Correctness first", calls: 2, promptTokens: 345, completionTokens: 6, costUsd: null, latencyMs: 10, simulated: true }],
  });
  const html = render(r);

  it("shows the verdict's message, the expected and actual outputs, the explanation and the shrink", () => {
    expect(html).toContain('<p class="muted">Found a minimal counterexample.</p>');
    expect(html).toMatch(/<span class="label">expected<\/span>[^]{0,80}>0</);
    expect(html).toMatch(/<span class="label">got<\/span>[^]{0,80}>-1</);
    expect(html).toContain("Because the loop stops early.");
    expect(html).toContain("in 3 steps, 9 candidate runs");
  });

  it("puts each count in its column: inputs attacked, tested per family, calls and tokens per stage, and why", () => {
    expect(html).toMatch(/<b>3<\/b><span>inputs attacked<\/span>/);
    expect(html).toMatch(/<b>5<\/b><span>sandbox runs<\/span>/);
    expect(html).toMatch(/<b>2<\/b><span>model calls<\/span>/);
    expect(html).toContain("(family single-element)");
    expect(html).toContain("<td>4</td>");
    expect(html).not.toContain("<td>7</td>");
    expect(html).toMatch(/Correctness first<\/div><\/td><td>.*?<\/td><td>2<\/td><td>351<\/td>/);
  });

  it("copies a Markdown report with every section: verdict, counterexample, why, fix in its language, and the setup", () => {
    const md = toMarkdown(r);
    expect(md).toContain("**Verdict:** Broken: minimal counterexample found. Found a minimal counterexample.");
    expect(md).toContain("expected: 0\ngot:      -1");
    expect(md).toContain("## Why\n\nBecause the loop stops early.");
    expect(md).toContain("```python\ndef solve(a, t):\n    return 0\n```");
    expect(md).toContain("3 inputs, 5 sandbox runs, 2 model calls");
    expect(md).toContain("Provider: replay; executor: Local.");
  });
});

describe("ReportView for every verdict", () => {
  it("names each verdict in the heading, including that an unreliable oracle claims no bug", () => {
    const heading = (verdict: ReturnType<typeof fullReport>["verdict"]) => render(fullReport({ verdict })).match(/<h2 class="verdict [a-z_]+">(.*?)<\/h2>/)![1];
    expect(heading("counterexample")).toBe("Broken: minimal counterexample found");
    expect(heading("no_counterexample")).toBe("Survived the attack");
    expect(heading("oracle_unreliable")).toBe("Oracle unreliable: no bug claimed");
    expect(heading("compile_error")).toBe("Solution does not compile");
    expect(heading("budget_exhausted")).toBe("Budget exhausted");
    expect(heading("error")).toBe("Error");
  });

  it("marks a replayed time to first counterexample as simulated, and shows a dash when there is none", () => {
    const stats = fullReport().stats;
    const tile = (html: string) => html.match(/<b>([^<]*)<\/b><span>to first counterexample<\/span>/)![1];
    expect(tile(render(fullReport({ stats: { ...stats, timeToFirstCounterexampleMs: 7400, simulatedModelMs: 7000 } })))).toBe("7.4 s*");
    expect(tile(render(fullReport({ stats: { ...stats, timeToFirstCounterexampleMs: 7400, simulatedModelMs: 0 } })))).toBe("7.4 s");
    expect(tile(render(fullReport({ stats: { ...stats, timeToFirstCounterexampleMs: null, simulatedModelMs: 7000 } })))).toBe("–");
  });

  it("makes each report section a heading, so screen readers can jump between them", () => {
    const headings = (r: ReturnType<typeof fullReport>) => [...render(r).matchAll(/<h3 class="label">(.*?)<\/h3>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
    expect(headings(fullReport())).toEqual([
      "Minimal counterexample",
      "Why it fails",
      "Proposed fix · re-attacked on 10 judged inputs: 0 failures",
      "Research (Tavily)",
      "Attack families",
      "Why Ultra here, Super there",
    ]);
    // The counterexample's heading is a heading in its other forms too.
    const cx = fullReport().counterexample!;
    expect(headings(fullReport({ counterexample: { ...cx, orderDependent: { precedingInputs: 2, sequence: [[1], [2], cx.args] } } }))[0]).toMatch(/^Counterexample \(fails only when run after 2 earlier input/);
    expect(headings(fullReport({ counterexample: { ...cx, shrinkExhausted: true } }))[0]).toBe("Counterexample (shrinking stopped early, may not be minimal)");
  });

  it("says the time to first counterexample includes simulated latency only when there is one", () => {
    const stage = { ...fullReport().stages[0]!, simulated: true };
    const stats = fullReport().stats;
    expect(render(fullReport({ stages: [stage] }))).toContain("(the time to first counterexample includes it).");
    expect(render(fullReport({ stages: [stage], stats: { ...stats, timeToFirstCounterexampleMs: null } }))).toContain("latency is simulated.</p>");
  });
});

describe("ReportView research citations", () => {
  it("shows each research fact with a link to its source", () => {
    const html = render(fullReport({ research: { queries: ["q"], facts: [{ fact: "Arrays may hold one element.", url: "https://leetcode.com/problems/binary-search/" }], influencedFamilies: [] } }));
    expect(html).toContain('<li>Arrays may hold one element. <a href="https://leetcode.com/problems/binary-search/" target="_blank" rel="noreferrer">source</a></li>');
  });
});

describe("ReportView puts every field in its own place (distinct values)", () => {
  const r = fullReport({
    families: [
      { name: "two-digit-starts", rationale: "Numbers with two leading digits.", citations: [], source: "model", generated: 9, dropped: 0, tested: 7, mismatches: 3, oracleSkipped: 2 },
      { name: "all-zero", rationale: "Every element zero.", citations: [], source: "model", generated: 4, dropped: 0, tested: 4, mismatches: 0, oracleSkipped: 0 },
    ],
    research: { queries: ["q"], facts: [{ fact: "Sorted ascending.", url: "https://example.com/d" }], influencedFamilies: ["two-digit-starts"] },
    stages: [
      { stage: "oracle", purpose: "oracle", role: "reasoning", model: "nvidia/ultra", why: "Correctness first", calls: 2, promptTokens: 300, completionTokens: 45, costUsd: 0.00042, latencyMs: 20, simulated: false },
      { stage: "attack", purpose: "generators", role: "fast", model: "nvidia/super", why: "Cheap and fast", calls: 1, promptTokens: 100, completionTokens: 10, costUsd: null, latencyMs: 10, simulated: false },
    ],
    stats: { modelCalls: 8, runs: 4567, inputsTested: 123, wallMs: 1, timeToFirstCounterexampleMs: 2500, costUsd: 0.075, unpricedCalls: 2, simulatedModelMs: 0 },
  });
  const html = render(r);

  it("shows each attack-families cell: name, tested, mismatches (red only when nonzero, never oracleSkipped), why", () => {
    expect(html).toContain("<code>two-digit-starts</code>");
    expect(html).toMatch(/<td><code>two-digit-starts<\/code><\/td><td>7<\/td><td class="bad">3<\/td><td class="small">Numbers with two leading digits.<\/td>/);
    // The failing family is red with its mismatch count (3), not its oracleSkipped (2); a clean family is 0 with no red.
    expect(html).not.toContain('<td class="bad">2</td>');
    expect(html).toMatch(/<td><code>all-zero<\/code><\/td><td>4<\/td><td class="">0<\/td>/);
  });

  it("shows each model-routing cell, the per-step cost (not the run total) and the tokens sum", () => {
    expect(html).toMatch(/<td>oracle<div class="small muted">Correctness first<\/div><\/td><td><code>ultra<\/code><\/td><td>2<\/td><td>345<\/td><td>\$0.00042<\/td>/);
    expect(html).toMatch(/<td><code>super<\/code>.*?<\/td><td>1<\/td><td>110<\/td><td>unpriced<\/td>/);
    // The per-step cost is the step's own, not the run total ($0.075).
    expect(html).toContain("<td>$0.00042</td>");
    expect(html).not.toContain("<td>$0.075</td>");
  });

  it("shows each stat tile with its own number", () => {
    expect(html).toContain("<b>123</b><span>inputs attacked</span>");
    expect(html).toContain("<b>4,567</b><span>sandbox runs</span>");
    expect(html).toContain("<b>8</b><span>model calls</span>");
    expect(html).toContain("<b>$0.075</b><span>model cost (+2 unpriced)</span>");
    expect(html).toContain("<b>2.5 s</b><span>to first counterexample</span>");
  });

  it("names the one shaped generator family (the line is shown for a single family too)", () => {
    expect(html).toContain("Shaped generator families: two-digit-starts");
  });
});

describe("ReportView region names tell a shared report from the reader's own", () => {
  it("prefixes a shared report's region names, and leaves the reader's own report's names plain", () => {
    const own = render(fullReport(), {});
    expect(own).toContain('aria-label="Attack families table"');
    expect(own).not.toContain("Shared report:");
    const sharedHtml = renderToStaticMarkup(createElement(ReportView, { r: fullReport(), onCopy: () => {} }));
    expect(sharedHtml).toContain('aria-label="Shared report: attack families table"');
  });
});
