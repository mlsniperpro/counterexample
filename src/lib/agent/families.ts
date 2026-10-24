import { z } from "zod";
import { mutateArgs } from "../core/mutate";
import { hashString, mulberry32, pick } from "../core/rng";
import { argsConform, arity, genArgs, parseTypeSpec, type TypeSpec } from "../core/spec";
import { errorMessage } from "../errors";
import { parseJsonAnswer } from "./parse";
import type { Family } from "./types";

const MAX_FAMILIES = 8;

/** The answer must be {"families": [...]}; each family is then validated on its own, so one bad family never sinks the rest. */
const familiesAnswerSchema = z.object({ families: z.array(z.unknown()) });
const familySchema = z.object({
  name: z.string().min(1).max(60),
  rationale: z.string().nullish().transform((r) => (r ?? "").slice(0, 400)),
  // A hint only: the budget caps it anyway.
  count: z.number().int().positive().nullish(),
  args: z.array(z.unknown()).min(1),
  citations: z.array(z.string().max(500)).nullish().transform((c) => (c ?? []).slice(0, 10)),
});

export type ParsedFamilies = { families: Family[]; rejected: { name: string; reason: string }[] };

/**
 * Validate the fast model's generator families. A family whose argument
 * specs don't parse or don't match the problem's arity is rejected with a
 * reason (shown in the trace), never silently patched.
 */
export function parseFamilies(text: string, specs: TypeSpec[], perFamily: number): ParsedFamilies {
  const answer = parseJsonAnswer(text, familiesAnswerSchema, "generator families");
  const want = specs.reduce((n, s) => n + arity(s), 0);
  const families: Family[] = [];
  const rejected: ParsedFamilies["rejected"] = [];
  const seen = new Set<string>();
  if (answer.families.length > MAX_FAMILIES) rejected.push({ name: "(extra)", reason: `only the first ${MAX_FAMILIES} families are used; ${answer.families.length - MAX_FAMILIES} ignored` });
  for (const [i, raw] of answer.families.slice(0, MAX_FAMILIES).entries()) {
    const parsed = familySchema.safeParse(raw);
    if (!parsed.success) {
      const name = typeof (raw as { name?: unknown } | null)?.name === "string" ? String((raw as { name: string }).name).slice(0, 60) : `family-${i}`;
      rejected.push({ name, reason: parsed.error.issues.map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`).join("; ") });
      continue;
    }
    const f = parsed.data;
    try {
      if (seen.has(f.name)) throw new Error("duplicate family name");
      const args = f.args.map((x, j) => parseTypeSpec(x, `families[${i}].args[${j}]`));
      const got = args.reduce((n, s) => n + arity(s), 0);
      if (got !== want) throw new Error(`expected ${want} argument(s), got ${got}`);
      seen.add(f.name);
      families.push({ name: f.name, rationale: f.rationale, citations: f.citations, args, count: Math.min(perFamily, f.count ?? perFamily), source: "model" });
    } catch (e) {
      rejected.push({ name: f.name, reason: errorMessage(e) });
    }
  }
  return { families, rejected };
}

export type Generated = { inputs: unknown[][]; dropped: number };

const seeded = (seed: number, salt: string, name: string) => mulberry32(hashString(`${seed}:${salt}:${name}`));

/** Deterministically generate a family's inputs; inputs that violate the problem's parameter specs are dropped and counted. */
export function generateInputs(f: Family, specs: TypeSpec[], seed: number, salt: string): Generated {
  const rng = seeded(seed, salt, f.name);
  const inputs: unknown[][] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (let i = 0; i < f.count; i++) {
    const args = genArgs(f.args, rng);
    if (!argsConform(args, specs)) {
      dropped++;
      continue;
    }
    const key = JSON.stringify(args);
    if (seen.has(key)) continue;
    seen.add(key);
    inputs.push(args);
  }
  return { inputs, dropped };
}

/** EvalPlus-style type-aware mutants of seed inputs, filtered by the problem's validator. */
export function mutationInputs(seeds: unknown[][], specs: TypeSpec[], count: number, seed: number, salt: string): Generated {
  if (seeds.length === 0) return { inputs: [], dropped: 0 };
  const rng = seeded(seed, salt, "mutations");
  const seen = new Set(seeds.map((s) => JSON.stringify(s)));
  const inputs: unknown[][] = [];
  let dropped = 0;
  for (let i = 0; i < count * 3 && inputs.length < count; i++) {
    // Stack 1 to 3 mutations on a random seed.
    let m = pick(rng, seeds);
    for (let k = 1 + Math.floor(rng() * 3); k > 0; k--) m = mutateArgs(m, rng);
    if (!argsConform(m, specs)) {
      dropped++;
      continue;
    }
    const key = JSON.stringify(m);
    if (seen.has(key)) continue;
    seen.add(key);
    inputs.push(m);
  }
  return { inputs, dropped };
}
