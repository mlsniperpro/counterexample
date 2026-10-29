import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { benchFixtures, CONFIGS, loadSubjects, markdown, median, referenceFor, replaceSection, summarise, tierTable, type Row } from "../../bench/lib";
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

  it("loads 30 buggy and 10 correct base subjects and 8 buggy and 6 correct hard ones, each bug documented", () => {
    const subjects = loadSubjects(process.cwd());
    const base = subjects.filter((s) => s.tier === "base");
    const hard = subjects.filter((s) => s.tier === "hard");
    expect(base.filter((s) => s.buggy)).toHaveLength(30);
    expect(base.filter((s) => !s.buggy)).toHaveLength(10);
    expect(hard.filter((s) => s.buggy)).toHaveLength(8);
    expect(hard.filter((s) => !s.buggy)).toHaveLength(6);
    expect(new Set(subjects.map((s) => s.key)).size).toBe(subjects.length);
    expect(hard.every((s) => s.key.startsWith("hard/"))).toBe(true);
    // Both languages in the hard tier, buggy and correct.
    expect(new Set(hard.filter((s) => s.buggy).map((s) => s.language))).toEqual(new Set(["python", "javascript"]));
    for (const s of subjects.filter((x) => x.buggy)) expect(s.bug.length).toBeGreaterThan(30);
    const fx = benchFixtures(subjects);
    expect(fx["isqrt/bug-a"]?.explain).toMatch(/^EXPLANATION: [\s\S]*```javascript\n/);
    // The replayed fix is the correct solution in the buggy solution's own language.
    for (const s of hard.filter((x) => x.buggy)) {
      expect(referenceFor(subjects, s).language).toBe(s.language);
      expect(fx[s.key]?.explain).toContain("```" + s.language + "\n" + referenceFor(subjects, s).code);
    }
  });

  it("splitHeader requires a BUG or CORRECT header", () => {
    expect(splitHeader("# BUG: x\ncode")).toEqual({ kind: "bug", bug: "x", code: "code" });
    expect(splitHeader("// CORRECT: y\ncode").kind).toBe("correct");
    expect(() => splitHeader("def solve(): pass")).toThrow(/header/);
  });

  it("summarises found bugs, false alarms and cost per configuration", () => {
    const row = (key: string, buggy: boolean, verdict: Row["verdict"], config: Row["config"] = "routed", tier: Row["tier"] = "base"): Row => ({
      key, tier, buggy, config, verdict, ttfcMs: verdict === "counterexample" ? 1000 : null, costUsd: 0.01, unpricedCalls: 0, modelCalls: 4, runs: 20, timeLimitMs: 300, inputs: 10, wallMs: 1, message: "", fixVerified: verdict === "counterexample" ? true : undefined,
    });
    const rows = [row("a", true, "counterexample"), row("b", true, "no_counterexample"), row("c", false, "counterexample"), row("d", false, "no_counterexample"), row("a", true, "error", "ultra-only")];
    const s = summarise(rows, "routed");
    expect(s).toMatchObject({ buggy: 2, found: 1, correct: 2, falseAlarms: 1, fixesVerified: 1, medianTtfcMs: 1000, errors: 0 });
    expect(s.totalCostUsd).toBeCloseTo(0.04);
    expect(summarise(rows, "ultra-only").errors).toBe(1);
    const md = markdown(rows, "fixture", "Local");
    expect(md).toContain(`| Metric | ${CONFIGS.map((c) => c.title).join(" | ")} |`);
    expect(md).toContain("| Bugs found (of 2 buggy) | 1 (50%) | 0 (0%) | 0 (n/a) |");
    expect(md).toContain("| `c` | base | correct | counterexample |");
  });

  it("says what fixture mode measures, and marks a counterexample whose shrinking stopped early as not minimal", () => {
    const base = { tier: "hard" as const, buggy: true, config: "routed" as const, verdict: "counterexample" as const, ttfcMs: 1, costUsd: 0, unpricedCalls: 0, modelCalls: 1, runs: 1, timeLimitMs: 300, inputs: 1, wallMs: 1, message: "", fixVerified: true };
    const rows: Row[] = [
      { ...base, key: "hard/a", minimal: [[1, 2]], shrinkExhausted: true },
      { ...base, key: "hard/b", minimal: [[3]], shrinkExhausted: false },
      { ...base, key: "hard/c", minimal: [[4]] },
    ];
    const md = markdown(rows, "fixture", "Local");
    expect(md).toContain("`[[1,2]]` (not minimal) |");
    expect(md).toContain("`[[3]]` |");
    expect(md).toContain("`[[4]]` |");
    expect(md.match(/\(not minimal\)/g)).toHaveLength(1);
    const mode = md.split("\n")[0]!;
    expect(mode).toContain("replayed hand-written stand-ins for model answers");
    expect(mode).toContain('each benchmark "fix" is the problem\'s correct reference solution, so "Fixes verified" is a pipeline check, not fix quality');
    expect(mode).not.toMatch(/recorded/);
    // Live mode has real fixes: the caveat belongs to fixture mode only.
    expect(markdown(rows, "live", "Judge0").split("\n")[0]).toBe("Mode: **live**. Executor: Judge0.");
  });

  it("reports each tier separately for the routed run and both ablations", () => {
    const row = (key: string, tier: Row["tier"], buggy: boolean, verdict: Row["verdict"], config: Row["config"]): Row => ({
      key, tier, buggy, config, verdict, ttfcMs: null, costUsd: 0, unpricedCalls: 0, modelCalls: 1, runs: 1, timeLimitMs: 300, inputs: 1, wallMs: 1, message: "", fixVerified: verdict === "counterexample" ? true : undefined,
    });
    const rows = [
      row("a", "base", true, "counterexample", "routed"),
      row("h1", "hard", true, "counterexample", "routed"),
      row("h2", "hard", true, "counterexample", "routed"),
      row("hc", "hard", false, "no_counterexample", "routed"),
      row("h1", "hard", true, "no_counterexample", "no-model"),
      row("h2", "hard", true, "counterexample", "no-model"),
      row("h1", "hard", true, "no_counterexample", "random-only"),
    ];
    expect(summarise(rows, "routed", "hard")).toMatchObject({ tier: "hard", buggy: 2, found: 2, correct: 1, falseAlarms: 0, fixesVerified: 2 });
    expect(summarise(rows, "no-model", "hard")).toMatchObject({ buggy: 2, found: 1 });
    expect(summarise(rows, "routed", "base")).toMatchObject({ buggy: 1, found: 1, correct: 0 });
    const t = tierTable(rows, "hard").join("\n");
    expect(t).toContain("2 buggy, 1 correct");
    expect(t).toContain("| Bugs found (of 2 buggy) | 2 (100%) | 1 (50%) | 0 (0%) |");
    expect(t).not.toContain("Ultra only");
    expect(tierTable(rows.filter((x) => x.tier === "base"), "hard")).toEqual([]);
    expect(markdown(rows, "fixture", "Local")).toContain("**Hard tier only**");
  });

  it("replaces only the marked README section", () => {
    const readme = "a\n<!-- bench:fixture:start -->\nold\n<!-- bench:fixture:end -->\nb\n";
    expect(replaceSection(readme, "fixture", "new\n\n")).toBe("a\n<!-- bench:fixture:start -->\nnew\n<!-- bench:fixture:end -->\nb\n");
    expect(() => replaceSection(readme, "live", "x")).toThrow(/markers/);
  });
});
