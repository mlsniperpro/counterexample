import { describe, expect, it } from "vitest";
import { cxHeading, ellipsize, fixSummary, fmtArgs, ms, toMarkdown } from "@/app/format";
import { exactReviver } from "@/lib/core/compare";
import { fullReport } from "../app-fixtures";

const fix = (over: Partial<Parameters<typeof fixSummary>[0]>) => ({ verified: false, reattackInputs: 10, reattackMismatches: 0, reattackUnjudged: 0, ...over });

describe("fixSummary (how the re-attack of a fix went)", () => {
  it("says 'still fails' and counts only judged inputs, with the unjudged ones named", () => {
    expect(fixSummary(fix({ reattackMismatches: 2, reattackUnjudged: 3 }))).toBe("still fails on 2 of 7 judged inputs (3 more the oracle could not judge)");
    expect(fixSummary(fix({ reattackMismatches: 2 }))).toBe("still fails on 2 of 10 judged inputs");
  });

  it("says 'incomplete' for a fix that did not fail but was not verified", () => {
    expect(fixSummary(fix({ reattackUnjudged: 3 }))).toBe("no failure on 7 judged inputs (3 more the oracle could not judge), but the re-attack was incomplete");
    expect(fixSummary(fix({}))).toBe("no failure on 10 judged inputs, but the re-attack was incomplete");
  });

  it("says 0 failures only for a verified fix", () => {
    expect(fixSummary(fix({ verified: true, reattackUnjudged: 3 }))).toBe("re-attacked on 7 judged inputs: 0 failures (3 more the oracle could not judge)");
    expect(fixSummary(fix({ verified: true }))).toBe("re-attacked on 10 judged inputs: 0 failures");
  });
});

describe("fmtArgs and exact big integers", () => {
  it("shows integers above 2^53 as digits, not as the reviver's marker strings", () => {
    const parsed = JSON.parse("[9007199254740993, [-9223372036854775807, 5], \"s\", null]", exactReviver) as unknown[];
    // The reviver needs JSON.parse source text access; without it the marker would not exist and this test would prove nothing.
    expect(JSON.stringify(parsed)).toContain("int:");
    expect(fmtArgs(parsed)).toBe('9007199254740993, [-9223372036854775807,5], "s", null');
    expect(fmtArgs(parsed)).not.toMatch(/int:|u0000/);
    expect(fmtArgs([[1, 2], "a", null])).toBe('[1,2], "a", null');
  });

  it("writes them as digits in the Markdown too", () => {
    const big = JSON.parse("[9007199254740993]", exactReviver) as unknown[];
    const md = toMarkdown(fullReport({ counterexample: { ...fullReport().counterexample!, args: big, expected: JSON.parse("9007199254740995", exactReviver) } }));
    expect(md).toContain("solve(9007199254740993)");
    expect(md).toContain("expected: 9007199254740995");
    expect(md).not.toMatch(/int:|u0000/);
  });
});

describe("toMarkdown headings", () => {
  it("marks a counterexample whose shrinking stopped early, and a minimal one otherwise", () => {
    const cx = fullReport().counterexample!;
    const early = toMarkdown(fullReport({ counterexample: { ...cx, shrinkExhausted: true } }));
    expect(early).toContain("## Counterexample (shrinking stopped early, may not be minimal)");
    expect(early).not.toContain("## Minimal counterexample");
    const minimal = toMarkdown(fullReport({ counterexample: { ...cx, shrinkExhausted: false } }));
    expect(minimal).toContain("## Minimal counterexample");
    expect(minimal).not.toContain("shrinking stopped early");
  });

  it("says NOT verified, with the reason, for an unverified fix", () => {
    const f = fullReport().fix!;
    const md = toMarkdown(fullReport({ fix: { ...f, verified: false, reattackInputs: 10, reattackMismatches: 0, reattackUnjudged: 4 } }));
    expect(md).toContain("## Fix (NOT verified: no failure on 6 judged inputs (4 more the oracle could not judge), but the re-attack was incomplete)");
  });
});

describe("ellipsize", () => {
  it("cuts long text with an ellipsis, keeps short text, and never splits a surrogate pair", () => {
    expect(ellipsize("abc", 3)).toBe("abc");
    expect(ellipsize("abcd", 3)).toBe("abc…");
    expect(ellipsize("ab😀cd", 3)).toBe("ab…");
    expect(ellipsize("x".repeat(500), 120)).toHaveLength(121);
  });
});

describe("counterexample heading", () => {
  it("names an order-dependent failure, an exhausted shrink, and a minimal counterexample", () => {
    expect(cxHeading({ shrinkExhausted: true, orderDependent: { precedingInputs: 3 } })).toMatch(/fails only after 3 earlier call\(s\).*keeps state/);
    expect(cxHeading({ shrinkExhausted: true })).toMatch(/may not be minimal/);
    expect(cxHeading({ shrinkExhausted: false })).toBe("Minimal counterexample");
  });
});

describe("durations", () => {
  it("switches to seconds at one second, after rounding, so it never prints 1000 ms", () => {
    expect([0, 12.4, 999.4, 999.5, 1000, 1049, 1050, 61_234].map(ms)).toEqual(["0 ms", "12 ms", "999 ms", "1.0 s", "1.0 s", "1.0 s", "1.1 s", "61.2 s"]);
  });
});
