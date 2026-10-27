import fc from "fast-check";
import { cpuClock } from "../helpers";
import { describe, expect, it } from "vitest";
import { generateInputs, mutationInputs, parseFamilies } from "@/lib/agent/families";
import { argsConform, inputsWithinBudget, SPEC_LIMITS, type TypeSpec } from "@/lib/core/spec";
import { ModelOutputError } from "@/lib/errors";
import { FIXTURES } from "@/fixtures/replay";
import { PROBLEMS } from "@/lib/problems/catalog";

const specs: TypeSpec[] = [
  { kind: "array", of: { kind: "int", min: -5, max: 5 }, len: { min: 0, max: 6 } },
  { kind: "int", min: -10, max: 10 },
];
const fam = (args: unknown[], extra: Record<string, unknown> = {}) => ({ name: "f", rationale: "r", args, ...extra });
const text = (families: unknown[]) => "```json\n" + JSON.stringify({ families }) + "\n```";

describe("parseFamilies", () => {
  it("accepts valid families and caps the count", () => {
    const r = parseFamilies(text([fam([specs[0], specs[1]], { count: 10_000, citations: ["https://x"] })]), specs, 300);
    expect(r.rejected).toEqual([]);
    expect(r.families[0]).toMatchObject({ name: "f", count: 300, citations: ["https://x"], source: "model" });
  });

  it("rejects, with a reason, families with bad specs, wrong arity or duplicate names", () => {
    const r = parseFamilies(
      text([fam([{ kind: "int", min: 3, max: 1 }, specs[1]]), { ...fam([specs[0]]), name: "short" }, { ...fam([specs[0], specs[1]]), name: "ok" }, { ...fam([specs[0], specs[1]]), name: "ok" }]),
      specs,
      100,
    );
    expect(r.families.map((f) => f.name)).toEqual(["ok"]);
    expect(r.rejected.map((x) => x.name)).toEqual(["f", "short", "ok"]);
    expect(r.rejected[0]!.reason).toMatch(/bad range/);
    expect(r.rejected[1]!.reason).toMatch(/expected 2 argument/);
    expect(r.rejected[2]!.reason).toMatch(/duplicate/);
  });

  it("throws ModelOutputError only when the answer itself is malformed", () => {
    expect(() => parseFamilies("no json here", specs, 10)).toThrow(ModelOutputError);
    expect(() => parseFamilies('{"families":"lots"}', specs, 10)).toThrow(/families/);
    expect(parseFamilies(text([]), specs, 10)).toEqual({ families: [], rejected: [] });
  });

  it("rejects a malformed family on its own and keeps the good ones", () => {
    const good = fam([specs[0], specs[1]], { name: "good" });
    const r = parseFamilies(text([good, { name: "zero", args: [specs[0], specs[1]], count: 0 }, { args: [] }, "nonsense"]), specs, 10);
    expect(r.families.map((f) => f.name)).toEqual(["good"]);
    expect(r.rejected.map((x) => x.name)).toEqual(["zero", "family-2", "family-3"]);
    expect(r.rejected[0]!.reason).toMatch(/count/);
  });

  it("treats null optional fields as unset and reports families beyond the cap", () => {
    const withNulls = { name: "n", rationale: null, count: null, citations: null, args: [{ ...specs[0], sorted: null, distinct: null, pool: null }, { kind: "int", min: 0, max: 1, bias: null }] };
    const many = Array.from({ length: 10 }, (_, i) => fam([specs[0], specs[1]], { name: `f${i}` }));
    expect(parseFamilies(text([withNulls]), specs, 7).families[0]).toMatchObject({ name: "n", rationale: "", count: 7, citations: [] });
    const r = parseFamilies(text(many), specs, 7);
    expect(r.families).toHaveLength(8);
    expect(r.rejected).toEqual([{ name: "(extra)", reason: expect.stringMatching(/2 ignored/) }]);
  });

  it("every recorded replay answer parses cleanly for its problem", () => {
    for (const p of PROBLEMS) {
      const r = parseFamilies(FIXTURES[p.id]?.generators as string, p.params.map((x) => x.type), 300);
      expect(r.rejected, p.id).toEqual([]);
      expect(r.families.length, p.id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("generateInputs / mutationInputs", () => {
  const family = { name: "f", rationale: "", citations: [], args: [specs[0]!, { kind: "int" as const, min: -20, max: 20 }], count: 200, source: "model" as const };

  it("is deterministic, deduplicated, conforming, and counts dropped inputs", () => {
    const a = generateInputs(family, specs, 1, "s");
    expect(generateInputs(family, specs, 1, "s")).toEqual(a);
    expect(generateInputs(family, specs, 2, "s")).not.toEqual(a);
    expect(new Set(a.inputs.map((x) => JSON.stringify(x))).size).toBe(a.inputs.length);
    expect(a.inputs.every((x) => argsConform(x, specs))).toBe(true);
    expect(a.dropped).toBeGreaterThan(0); // the family's int range is wider than the problem's
  });

  it("cuts a family of maximal inputs to its value budget, so it stays fast and small", () => {
    const huge: TypeSpec = { kind: "array", of: { kind: "int", min: 0, max: 9 }, len: { min: SPEC_LIMITS.maxValuesPerInput, max: SPEC_LIMITS.maxValuesPerInput } };
    const cpu = cpuClock();
    const g = generateInputs({ ...family, args: [huge], count: 300 }, [huge], 1, "s");
    expect(g.inputs.length).toBe(Math.floor(SPEC_LIMITS.maxValuesPerFamily / SPEC_LIMITS.maxValuesPerInput));
    expect(cpu()).toBeLessThan(600);
    expect(mutationInputs(g.inputs, [huge], 300, 1, "m").inputs.length).toBeLessThanOrEqual(SPEC_LIMITS.maxValuesPerFamily / SPEC_LIMITS.maxValuesPerInput);
    expect(inputsWithinBudget([{ kind: "int", min: 0, max: 1 }], 300)).toBe(300);
  });

  it("mutants always conform and never repeat a seed", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.array(fc.integer({ min: -5, max: 5 }), { maxLength: 6 }), fc.integer({ min: -10, max: 10 })), { minLength: 1, maxLength: 5 }), fc.integer(), (seeds, seed) => {
        const r = mutationInputs(seeds, specs, 50, seed, "m");
        expect(r.inputs.length).toBeLessThanOrEqual(50);
        const seedKeys = new Set(seeds.map((s) => JSON.stringify(s)));
        for (const x of r.inputs) {
          expect(argsConform(x, specs)).toBe(true);
          expect(seedKeys.has(JSON.stringify(x))).toBe(false);
        }
      }),
    );
    expect(mutationInputs([], specs, 10, 1, "m")).toEqual({ inputs: [], dropped: 0 });
  });
});
