import fc from "fast-check";
import type { TypeSpec } from "@/lib/core/spec";

/** Small integer ranges with min <= max. */
export const rangeArb = (lo: number, hi: number) =>
  fc.tuple(fc.integer({ min: lo, max: hi }), fc.integer({ min: lo, max: hi })).map(([a, b]) => ({ min: Math.min(a, b), max: Math.max(a, b) }));

const intSpec = fc
  .tuple(rangeArb(-1000, 1000), fc.constantFrom<"uniform" | "edges" | "small">("uniform", "edges", "small"))
  .map(([r, bias]): TypeSpec => ({ kind: "int", ...r, bias }));
const stringSpec = fc
  .tuple(fc.string({ minLength: 1, maxLength: 6, unit: "grapheme-ascii" }), rangeArb(0, 12))
  .map(([alphabet, len]): TypeSpec => ({ kind: "string", alphabet, len }));
const constSpec = fc.oneof(fc.integer(), fc.string(), fc.boolean()).map((value): TypeSpec => ({ kind: "const", value }));

/** Random non-graph TypeSpecs, nested at most `depth` levels, small enough to generate quickly. */
export const typeSpecArb: fc.Arbitrary<TypeSpec> = fc.letrec<{ spec: TypeSpec }>((tie) => ({
  spec: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    intSpec,
    stringSpec,
    constSpec,
    fc
      .record({
        of: tie("spec"),
        len: rangeArb(0, 6),
        sorted: fc.constantFrom<"asc" | "desc" | undefined>(undefined, "asc", "desc"),
        distinct: fc.boolean(),
        pool: fc.option(fc.integer({ min: 1, max: 4 }), { nil: undefined }),
      })
      .map((r): TypeSpec => ({ kind: "array", ...r })),
    fc
      .record({ items: fc.array(tie("spec"), { minLength: 1, maxLength: 3 }) })
      .map((r): TypeSpec => ({ kind: "tuple", items: r.items })),
    fc.array(tie("spec"), { minLength: 1, maxLength: 3 }).map((options): TypeSpec => ({ kind: "oneOf", options })),
  ),
})).spec;

export const graphSpecArb = fc
  .record({ n: rangeArb(1, 8), m: rangeArb(0, 12), weight: rangeArb(-5, 10), dag: fc.boolean(), shape: fc.constantFrom<"random" | "path" | undefined>(undefined, "random", "path") })
  .map((r): TypeSpec => ({ kind: "graph", ...r }));

/** Arbitrary JSON-like values (what solutions return). */
export const jsonValueArb = fc.jsonValue({ maxDepth: 3 });
