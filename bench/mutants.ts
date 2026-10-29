/**
 * Source-level mutation operators (as in mutation testing) for generating
 * many buggy programs from the correct benchmark solutions. Each mutant
 * changes exactly one token occurrence. Comments and string literals are
 * never touched. Pure and unit-tested in tests/unit/mutants.test.ts.
 */
import type { Language } from "../src/lib/exec/types";

export type Mutant = { id: string; operator: string; line: number; before: string; after: string; code: string };

type Op = { name: string; re: RegExp; to: string[] | ((m: string) => string[]) };

const SHARED: Op[] = [
  { name: "rel <= to <", re: /<=/g, to: ["<"] },
  { name: "rel >= to >", re: />=/g, to: [">"] },
  { name: "rel < to <=", re: /(?<![<=!-])<(?![<=])/g, to: ["<="] },
  { name: "rel > to >=", re: /(?<![>=\-])>(?![>=])/g, to: [">="] },
  { name: "min/max swap", re: /\b(min|max)\b/g, to: (m) => [m === "min" ? "max" : "min"] },
  { name: "+1 dropped", re: /\s\+\s1\b/g, to: [""] },
  { name: "-1 dropped", re: /\s-\s1\b/g, to: [""] },
  { name: "+ to -", re: /(?<=\w|\))\s\+\s(?=[\w(])/g, to: [" - "] },
  { name: "- to +", re: /(?<=\w|\))\s-\s(?=[\w(])/g, to: [" + "] },
  { name: "literal 0/1 nudged", re: /(?<![\w.])[01](?![\w.])/g, to: (m) => [m === "0" ? "1" : "0"] },
];

const PYTHON: Op[] = [
  ...SHARED,
  { name: "== to !=", re: /==/g, to: ["!="] },
  { name: "!= to ==", re: /!=/g, to: ["=="] },
  { name: "and/or swap", re: /\b(and|or)\b/g, to: (m) => [m === "and" ? "or" : "and"] },
  { name: "is None negated", re: /\bis not None\b|\bis None\b/g, to: (m) => [m === "is None" ? "is not None" : "is None"] },
];

const JAVASCRIPT: Op[] = [
  ...SHARED,
  { name: "=== to !==", re: /===/g, to: ["!=="] },
  { name: "!== to ===", re: /!==/g, to: ["==="] },
  { name: "&&/|| swap", re: /&&|\|\|/g, to: (m) => [m === "&&" ? "||" : "&&"] },
];

/** Character ranges of comments and string literals on one line (approximate, single-line). */
function protectedRanges(line: string, language: Language): [number, number][] {
  const out: [number, number][] = [];
  const comment = language === "python" ? "#" : "//";
  let i = 0;
  while (i < line.length) {
    const c = line[i] as string;
    if (line.startsWith(comment, i)) {
      out.push([i, line.length]);
      break;
    }
    if (c === '"' || c === "'" || c === "`") {
      const start = i++;
      while (i < line.length && line[i] !== c) i += line[i] === "\\" ? 2 : 1;
      out.push([start, i + 1]);
    }
    i++;
  }
  return out;
}

/** Every single-point mutant of a program, deduplicated and excluding no-op changes. */
export function mutants(code: string, language: Language): Mutant[] {
  const ops = language === "python" ? PYTHON : JAVASCRIPT;
  const lines = code.split("\n");
  const seen = new Set<string>([code]);
  const out: Mutant[] = [];
  lines.forEach((line, ln) => {
    const guarded = protectedRanges(line, language);
    for (const op of ops) {
      for (const m of line.matchAll(op.re)) {
        const at = m.index ?? 0;
        if (guarded.some(([a, b]) => at >= a && at < b)) continue;
        const tos = typeof op.to === "function" ? op.to(m[0]) : op.to;
        for (const to of tos) {
          const mutatedLine = line.slice(0, at) + to + line.slice(at + m[0].length);
          const mutated = [...lines.slice(0, ln), mutatedLine, ...lines.slice(ln + 1)].join("\n");
          if (seen.has(mutated)) continue;
          seen.add(mutated);
          out.push({ id: `L${ln + 1}c${at + 1}:${op.name}`, operator: op.name, line: ln + 1, before: line.trim(), after: mutatedLine.trim(), code: mutated });
        }
      }
    }
  });
  return out;
}
