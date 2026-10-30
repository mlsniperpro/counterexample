import { describe, expect, it } from "vitest";
import { BUILT_INS } from "@/lib/problems/catalog";
import { uiProblems } from "@/app/ui-problems";

// The page renders these fields for each built-in; nothing else checks the mapping from the catalog.
describe("uiProblems", () => {
  it("gives the page every built-in with its own statement, examples, language and demo code", () => {
    const ui = uiProblems();
    expect(ui).toHaveLength(BUILT_INS.length);
    BUILT_INS.forEach((b, i) => {
      expect(ui[i]).toEqual({
        id: b.problem.id,
        title: b.problem.title,
        statement: b.problem.statement,
        examples: b.problem.examples,
        language: b.demo.language,
        code: b.demo.code,
      });
    });
    // The catalog has demos in both languages, so a hard-coded language would fail the equality above.
    expect(new Set(ui.map((p) => p.language))).toEqual(new Set(["python", "javascript"]));
    // Statement is not the title, and the code is the demo's buggy solution (not empty).
    expect(ui.every((p) => p.statement !== p.title && p.code.length > 0 && p.examples.length > 0)).toBe(true);
  });
});
