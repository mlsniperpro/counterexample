import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { lineDiff, MAX_DIFF_CELLS } from "@/lib/diff";

const lines = fc.array(fc.constantFrom("a", "b", "c", "lo <= hi", "return -1", ""), { maxLength: 30 });

describe("lineDiff", () => {
  it("reconstructs both sides exactly, and keeps a longest common subsequence", () => {
    fc.assert(
      fc.property(lines, lines, (xs, ys) => {
        const a = xs.join("\n");
        const b = ys.join("\n");
        const d = lineDiff(a, b)!;
        expect(d.filter((l) => l.op !== "add").map((l) => l.text).join("\n")).toBe(a.replace(/\n$/, ""));
        expect(d.filter((l) => l.op !== "del").map((l) => l.text).join("\n")).toBe(b.replace(/\n$/, ""));
        // LCS is symmetric in length, so "same" counts agree both ways.
        expect(lineDiff(b, a)!.filter((l) => l.op === "same").length).toBe(d.filter((l) => l.op === "same").length);
      }),
    );
  });

  it("shows a one-line fix as one deletion and one addition", () => {
    const before = "def solve(nums, target):\n    lo, hi = 0, len(nums) - 1\n    while lo < hi:\n        pass\n";
    const after = before.replace("while lo < hi:", "while lo <= hi:");
    expect(lineDiff(before, after)!.filter((l) => l.op !== "same")).toEqual([
      { op: "del", text: "    while lo < hi:" },
      { op: "add", text: "    while lo <= hi:" },
    ]);
    expect(lineDiff(before, before)!.every((l) => l.op === "same")).toBe(true);
  });

  it("treats CRLF pasted code like LF", () => {
    const lf = "a\nb\nc\n";
    expect(lineDiff(lf.replace(/\n/g, "\r\n"), lf.replace("b", "B"))!.filter((l) => l.op !== "same")).toEqual([
      { op: "del", text: "b" },
      { op: "add", text: "B" },
    ]);
  });

  it("refuses inputs too large for the quadratic table", () => {
    const big = Array.from({ length: Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 1 }, (_, i) => `l${i}`).join("\n");
    expect(lineDiff(big, big + "\nx")).toBeNull();
  });
});
