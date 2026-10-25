import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { splitCode } from "@/app/inline-code";
import { PROBLEMS } from "@/lib/problems/catalog";

describe("splitCode (backtick code spans in problem statements)", () => {
  it("splits paired backticks into code spans", () => {
    expect(splitCode("Given `nums` and `target`, return -1.")).toEqual([
      { code: false, text: "Given " },
      { code: true, text: "nums" },
      { code: false, text: " and " },
      { code: true, text: "target" },
      { code: false, text: ", return -1." },
    ]);
  });

  it("keeps an unmatched backtick and an empty pair as literal text", () => {
    expect(splitCode("a `b` c ` d")).toEqual([
      { code: false, text: "a " },
      { code: true, text: "b" },
      { code: false, text: " c ` d" },
    ]);
    expect(splitCode("x `` y")).toEqual([{ code: false, text: "x `` y" }]);
    expect(splitCode("")).toEqual([]);
  });

  it("passes markup through as text (it is rendered as text nodes, never parsed as HTML)", () => {
    expect(splitCode("`<img src=x onerror=alert(1)>`")).toEqual([{ code: true, text: "<img src=x onerror=alert(1)>" }]);
  });

  it("loses no characters except the backticks of each code span", () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom("a", "`", " ", "<") }), (s) => {
        const spans = splitCode(s);
        expect(spans.map((p) => (p.code ? `\`${p.text}\`` : p.text)).join("")).toBe(s);
        spans.forEach((p, i) => i > 0 && expect(p.code || spans[i - 1]!.code).toBe(true));
      }),
    );
  });

  it("finds code spans in every built-in statement that uses backticks, with none left over", () => {
    for (const p of PROBLEMS) {
      const spans = splitCode(p.statement);
      if (p.statement.includes("`")) expect(spans.some((x) => x.code)).toBe(true);
      expect(spans.filter((x) => !x.code).some((x) => x.text.includes("`"))).toBe(false);
    }
  });
});
