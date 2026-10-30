import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExampleLine, ProblemBrief, TraceEventLine } from "@/app/trace-view";
import type { TraceEvent } from "@/lib/agent/trace";

// The trace is the headline artifact, and AttackUI (which renders it) is a stateful client component that no test
// mounts. These pure pieces are extracted so each field is pinned with distinct values here.
describe("TraceEventLine", () => {
  it("puts the time, stage, message and why each in its own span, not a sibling field", () => {
    const e: TraceEvent = { seq: 7, t: 1234, stage: "oracle", kind: "model_call", msg: "oracle via nvidia/u", data: { why: "The reasoning model writes the oracle." } };
    const html = renderToStaticMarkup(createElement(TraceEventLine, { e }));
    expect(html).toContain('<span class="t">1.2 s</span>'); // ms(e.t), not e.seq (would be "7 ms") or the raw number
    expect(html).toContain('<span class="st">oracle</span>'); // e.stage, not e.kind ("model_call")
    expect(html).toContain('<span class="msg">oracle via nvidia/u</span>'); // e.msg, not e.stage or e.kind
    expect(html).toContain('<span class="why">The reasoning model writes the oracle.</span>'); // e.data.why, not purpose/model
  });

  it("formats a small elapsed time in ms and shows a why span only for model calls", () => {
    // The info event carries data too (as real ones do), so only the kind check keeps a why span off it.
    const e: TraceEvent = { seq: 0, t: 12, stage: "run", kind: "info", msg: "running the solution", data: { family: "small-scope" } };
    const html = renderToStaticMarkup(createElement(TraceEventLine, { e }));
    expect(html).toContain('<span class="t">12 ms</span>');
    expect(html).toContain('<span class="msg">running the solution</span>');
    expect(html).not.toContain('class="why"'); // only model_call events carry a why span
  });

  it("lists each research fact with its source link, opening in a new tab", () => {
    const e: TraceEvent = { seq: 3, t: 50, stage: "research", kind: "research", msg: "searched the docs", data: { facts: [{ fact: "A year divisible by 100 is a leap year only if also divisible by 400.", url: "https://example.com/leap" }] } };
    const html = renderToStaticMarkup(createElement(TraceEventLine, { e }));
    expect(html).toContain("A year divisible by 100 is a leap year only if also divisible by 400.");
    expect(html).toContain('href="https://example.com/leap"');
    expect(html).toContain('target="_blank"');
  });
});

describe("ExampleLine", () => {
  it("shows solve(args) then the output, not the output then the args", () => {
    const html = renderToStaticMarkup(createElement(ExampleLine, { e: { args: [[2, 5], 6], output: 2 } }));
    expect(html).toContain("solve([2,5], 6) → 2");
    expect(html).not.toContain("solve(2)"); // a mutant swapping args and output would render solve(2) → [2,5], 6
  });
});

describe("ProblemBrief", () => {
  it("shows the problem's own statement, with inline code, and every one of its examples", () => {
    const html = renderToStaticMarkup(
      createElement(ProblemBrief, {
        statement: "Return the index of `target` in nums, or -1.",
        examples: [
          { args: [[1, 3, 5], 3], output: 1 },
          { args: [[2, 4], 7], output: -1 },
        ],
      }),
    );
    expect(html).toContain('<p class="statement">Return the index of <code>target</code> in nums, or -1.</p>');
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain("solve([1,3,5], 3) → 1");
    expect(html).toContain("solve([2,4], 7) → -1");
  });
});
