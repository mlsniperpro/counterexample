import { describe, expect, it } from "vitest";
import { mutants } from "../../bench/mutants";
import { loadSubjects } from "../../bench/lib";

describe("source mutation operators", () => {
  it("changes exactly one line per mutant, never the original, never twice the same", () => {
    for (const s of loadSubjects(process.cwd()).filter((x) => !x.buggy)) {
      const ms = mutants(s.code, s.language);
      expect(ms.length, s.key).toBeGreaterThan(2);
      expect(new Set(ms.map((m) => m.code)).size).toBe(ms.length);
      for (const m of ms) {
        const a = s.code.split("\n");
        const b = m.code.split("\n");
        expect(b).toHaveLength(a.length);
        expect(a.filter((l, i) => l !== b[i])).toHaveLength(1);
      }
    }
  });

  it("applies relational, arithmetic, logical and literal operators", () => {
    const py = mutants("def solve(a, b):\n    if a <= b and a != 0:\n        return max(a + 1, b)\n    return -1\n", "python").map((m) => m.after);
    expect(py).toEqual(
      expect.arrayContaining(["if a < b and a != 0:", "if a <= b or a != 0:", "if a <= b and a == 0:", "return min(a + 1, b)", "return max(a, b)", "return max(a - 1, b)", "if a <= b and a != 1:"]),
    );
    const js = mutants("function solve(a) {\n  return a.length > 0 && a[0] === 1;\n}\n", "javascript").map((m) => m.after);
    expect(js).toEqual(expect.arrayContaining(["return a.length >= 0 && a[0] === 1;", "return a.length > 0 || a[0] === 1;", "return a.length > 0 && a[0] !== 1;"]));
  });

  it("never touches comments, strings or arrow functions", () => {
    const js = mutants('const f = (x) => x; // a < b\nconst s = "a < b";\n', "javascript");
    expect(js.map((m) => m.after).some((l) => l.includes("=>=") || l.includes("// a <= b") || l.includes('"a <= b"'))).toBe(false);
    expect(mutants("# x < y\ns = 'a == b'\n", "python")).toEqual([]);
  });
});
