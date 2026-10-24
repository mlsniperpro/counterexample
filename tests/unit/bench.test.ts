import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { benchFixtures, CONFIGS, loadSubjects, markdown, median, replaceSection, summarise, type Row } from "../../bench/lib";
import { splitHeader } from "../../scripts/gen-demos";

describe("benchmark library", () => {
  it("median matches a sort-based definition", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1, maxLength: 30 }), (xs) => {
        const s = [...xs].sort((a, b) => a - b);
        const m = median(xs)!;
        expect(s.filter((x) => x < m).length).toBeLessThanOrEqual(xs.length / 2);
        expect(s.filter((x) => x > m).length).toBeLessThanOrEqual(xs.length / 2);
      }),
    );
    expect(median([])).toBeNull();
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it("loads 30 buggy and 10 correct subjects, each with a documented bug", () => {
    const subjects = loadSubjects(process.cwd());
    expect(subjects.filter((s) => s.buggy)).toHaveLength(30);
    expect(subjects.filter((s) => !s.buggy)).toHaveLength(10);
    for (const s of subjects.filter((x) => x.buggy)) expect(s.bug.length).toBeGreaterThan(30);
    const fx = benchFixtures(subjects);
    expect(fx["isqrt/bug-a"]?.explain).toMatch(/^EXPLANATION: [\s\S]*```javascript\n/);
  });

  it("splitHeader requires a BUG or CORRECT header", () => {
    expect(splitHeader("# BUG: x\ncode")).toEqual({ kind: "bug", bug: "x", code: "code" });
    expect(splitHeader("// CORRECT: y\ncode").kind).toBe("correct");
    expect(() => splitHeader("def solve(): pass")).toThrow(/header/);
  });

  it("summarises found bugs, false alarms and cost per configuration", () => {
    const row = (key: string, buggy: boolean, verdict: Row["verdict"], config: Row["config"] = "routed"): Row => ({
      key, buggy, config, verdict, ttfcMs: verdict === "counterexample" ? 1000 : null, costUsd: 0.01, unpricedCalls: 0, modelCalls: 4, runs: 20, inputs: 10, wallMs: 1, message: "", fixVerified: verdict === "counterexample" ? true : undefined,
    });
    const rows = [row("a", true, "counterexample"), row("b", true, "no_counterexample"), row("c", false, "counterexample"), row("d", false, "no_counterexample"), row("a", true, "error", "ultra-only")];
    const s = summarise(rows, "routed");
    expect(s).toMatchObject({ buggy: 2, found: 1, correct: 2, falseAlarms: 1, fixesVerified: 1, medianTtfcMs: 1000, errors: 0 });
    expect(s.totalCostUsd).toBeCloseTo(0.04);
    expect(summarise(rows, "ultra-only").errors).toBe(1);
    const md = markdown(rows, "fixture", "Local");
    expect(md).toContain(`| Metric | ${CONFIGS.map((c) => c.title).join(" | ")} |`);
    expect(md).toContain("| Bugs found (of 2 buggy) | 1 (50%) | 0 (0%) | 0 (n/a) |");
    expect(md).toContain("| `c` | correct | counterexample |");
  });

  it("replaces only the marked README section", () => {
    const readme = "a\n<!-- bench:fixture:start -->\nold\n<!-- bench:fixture:end -->\nb\n";
    expect(replaceSection(readme, "fixture", "new\n\n")).toBe("a\n<!-- bench:fixture:start -->\nnew\n<!-- bench:fixture:end -->\nb\n");
    expect(() => replaceSection(readme, "live", "x")).toThrow(/markers/);
  });
});
