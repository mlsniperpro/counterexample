import { pick, randInt, type Rng } from "./rng";

/**
 * Type-aware mutation of concrete inputs, after EvalPlus (Liu et al., NeurIPS
 * 2023): small edits to known inputs (the statement's examples and inputs the
 * model's families produced) often reach corner cases that neither random nor
 * model-designed generation hit. Mutants are not guaranteed valid; callers
 * filter them with the problem's validator.
 */
export function mutateValue(v: unknown, rng: Rng, depth = 0): unknown {
  if (typeof v === "number" && Number.isInteger(v)) {
    const ops = [v + 1, v - 1, -v, 0, v * 2, Math.trunc(v / 2)];
    return pick(rng, ops);
  }
  if (typeof v === "string") return mutateSequence([...v], rng, depth, () => (v.length ? pick(rng, [...v]) : "a")).join("");
  if (Array.isArray(v)) return mutateSequence(v, rng, depth, () => (v.length ? structuredClone(pick(rng, v)) : 0));
  return v;
}

function mutateSequence<T>(xs: T[], rng: Rng, depth: number, fresh: () => T): T[] {
  const n = xs.length;
  const out = [...xs];
  const i = n ? randInt(rng, 0, n - 1) : 0;
  switch (randInt(rng, 0, n ? 5 : 0)) {
    case 0: // insert a copy of an existing element (duplicates)
      out.splice(randInt(rng, 0, n), 0, fresh());
      break;
    case 1: // delete one
      out.splice(i, 1);
      break;
    case 2: // swap neighbours
      if (n > 1) {
        const j = i === n - 1 ? i - 1 : i + 1;
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      break;
    case 3: // repeat a slice
      out.splice(i, 0, ...xs.slice(i, i + randInt(rng, 1, Math.max(1, n - i))));
      break;
    case 4: // reverse
      out.reverse();
      break;
    default: // mutate one element in place
      if (depth < 3) out[i] = mutateValue(xs[i], rng, depth + 1) as T;
  }
  return out;
}

/** Mutate one argument of an argument list. */
export function mutateArgs(args: unknown[], rng: Rng): unknown[] {
  if (args.length === 0) return args;
  const i = randInt(rng, 0, args.length - 1);
  return args.map((a, j) => (j === i ? mutateValue(a, rng) : a));
}
