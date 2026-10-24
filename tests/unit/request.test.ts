import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildAttackBody, type AttackForm } from "@/app/request";
import { attackBodySchema } from "@/lib/agent/api";

const base: AttackForm = { problemId: "isqrt", statement: "", code: "function solve(x) { return x; }", language: "javascript", ultraOnly: false, researchWeb: false };

describe("buildAttackBody (what the UI sends)", () => {
  it("maps the Research the web toggle to research=force, and off to auto", () => {
    expect(buildAttackBody({ ...base, researchWeb: true }).research).toBe("force");
    expect(buildAttackBody(base).research).toBe("auto");
  });

  it("maps the Ultra toggle to routing and sends a statement only for custom problems", () => {
    expect(buildAttackBody({ ...base, ultraOnly: true }).routing).toBe("ultra-only");
    expect(buildAttackBody(base)).not.toHaveProperty("statement");
    expect(buildAttackBody({ ...base, problemId: null, statement: "Sum two ints." })).toMatchObject({ statement: "Sum two ints." });
  });

  it("always produces a body the server schema accepts", () => {
    fc.assert(
      fc.property(
        fc.record({
          problemId: fc.option(fc.constantFrom("isqrt", "binary-search"), { nil: null }),
          statement: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
          code: fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length > 0),
          language: fc.constantFrom<"python" | "javascript">("python", "javascript"),
          ultraOnly: fc.boolean(),
          researchWeb: fc.boolean(),
        }),
        (form) => {
          const parsed = attackBodySchema.safeParse(buildAttackBody(form));
          expect(parsed.success).toBe(true);
          if (parsed.success) expect(parsed.data.research).toBe(form.researchWeb ? "force" : "auto");
        },
      ),
    );
  });
});
