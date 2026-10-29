/**
 * Soak and soundness run: attack every single-point mutant of every benchmark
 * solution (correct and buggy), with several seeds, in replay mode, then check
 * the agent's claims independently against the problem's correct solution:
 *
 * - every claimed counterexample must be real: the reference solution must
 *   return the oracle's expected value and the mutant must not (soundness);
 * - every "no counterexample" verdict gets an independent differential search
 *   (3,000 uniform inputs, a different seed) to count bugs the agent missed.
 *
 *   pnpm soak                        # mutants of the correct solutions, seed 1
 *   pnpm soak --all --seeds 3 -j 4   # mutants of all solutions (both tiers), seeds 1..3
 *   add --readme to rewrite the README's soak section
 *
 * Writes bench/results/soak.{json,md}. Exits non-zero if any claim is unsound
 * or any run crashes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { attack } from "../src/lib/agent/run";
import { makeDeps } from "../src/lib/agent/setup";
import { FIXTURES } from "../src/fixtures/replay";
import { extractCode } from "../src/lib/agent/parse";
import { displayable, outputsEqual } from "../src/lib/core/compare";
import { hashString, mulberry32 } from "../src/lib/core/rng";
import { genArgs } from "../src/lib/core/spec";
import { LocalExecutor } from "../src/lib/exec/local";
import type { RunOutcome } from "../src/lib/exec/types";
import { Semaphore } from "../src/lib/limit";
import { getProblem } from "../src/lib/problems/catalog";
import type { Problem, Solution } from "../src/lib/problems/types";
import { benchFixtures, loadSubjects, replaceSection, type Subject } from "./lib";
import { mutants } from "./mutants";

const ROOT = join(__dirname, "..");
const DIFF_INPUTS = 3000;

type Outcome = "killed" | "survived" | "missed" | "unsound" | "error";
type Row = { key: string; seed: number; operator: string; after: string; verdict: string; outcome: Outcome; detail: string; wallMs: number };

const executor = new LocalExecutor();
const show = (o: RunOutcome | undefined) => (o === undefined ? "nothing" : o.ok ? JSON.stringify(o.out) : `${o.error}`);

async function runOn(p: Problem, s: Solution, inputs: unknown[][]): Promise<RunOutcome[]> {
  return (await executor.run({ language: s.language, code: s.code, entry: s.entry, inputs, timeLimitMs: p.timeLimitMs, memoryLimitMb: p.memoryLimitMb })).outcomes;
}

/**
 * Independent check of a claimed counterexample against the reference solution.
 * A report clips a huge expected output to its display text, so then the
 * recorded oracle is re-run on the counterexample: its full output must match
 * the reported text, and the reference must match its full output.
 */
async function confirm(p: Problem, ref: Solution, mutant: Solution, args: unknown[], expected: unknown, got: string): Promise<string | null> {
  const [r] = await runOn(p, ref, [args]);
  const [m] = await runOn(p, mutant, [args]);
  if (!r?.ok) return `reference failed on the counterexample: ${show(r)}`;
  let want = expected;
  if (typeof expected === "string" && displayable(r.out) !== r.out) {
    const oracle: Solution = { language: "python", code: extractCode(FIXTURES[p.id]?.oracle as string, "python"), entry: "solve" };
    const [o] = await runOn(p, oracle, [args]);
    if (!o?.ok) return `oracle failed on a re-run of the counterexample: ${show(o)}`;
    if (displayable(o.out) !== expected) return "the reported (clipped) expected output does not match a re-run of the oracle";
    want = o.out;
  }
  if (!outputsEqual(r.out, want, p.compare)) return `oracle said ${JSON.stringify(expected)}, reference says ${show(r)}`;
  // A timeout claims the mutant is too slow, not wrong: it holds when the mutant times out again or still needs at
  // least half its time limit on that input (the attack's machine may have been busier than this re-run's).
  if (got.startsWith("timeout") && (!m?.ok ? m?.error === "timeout" : m.ms >= p.timeLimitMs / 2)) return null;
  if (m?.ok && outputsEqual(m.out, r.out, p.compare)) return `mutant agrees with the reference on ${JSON.stringify(args)}`;
  return null;
}

/** Independent differential search for a bug the agent did not report. */
async function search(p: Problem, ref: Solution, mutant: Solution, seed: number): Promise<unknown[] | null> {
  const rng = mulberry32(hashString(`soak-diff:${seed}:${p.id}`));
  const specs = p.params.map((x) => x.type);
  const inputs = Array.from({ length: DIFF_INPUTS }, () => genArgs(specs, rng));
  const [r, m] = await Promise.all([runOn(p, ref, inputs), runOn(p, mutant, inputs)]);
  for (let i = 0; i < inputs.length; i++) {
    const a = r[i];
    const b = m[i];
    if (a?.ok && !(b?.ok && outputsEqual(a.out, b.out, p.compare))) return inputs[i] ?? null;
  }
  return null;
}

async function main(args: string[]) {
  const all = args.includes("--all");
  const seeds = Number(args[args.indexOf("--seeds") + 1] ?? 1) || 1;
  const conc = Number(args[args.indexOf("-j") + 1] ?? 4) || 4;
  const subjects = loadSubjects(ROOT);
  const fixtures = benchFixtures(subjects);
  const refs = new Map(subjects.filter((s) => !s.buggy).map((s) => [`${s.problem}:${s.language}`, s]));
  const jobs: { subject: Subject; m: ReturnType<typeof mutants>[number]; seed: number }[] = [];
  const attacked = subjects.filter((s) => all || !s.buggy);
  const scope = all ? `of all ${attacked.length} benchmark solutions` : `of the ${attacked.length} correct solutions`;
  for (const subject of attacked) {
    for (const m of mutants(subject.code, subject.language)) for (let seed = 1; seed <= seeds; seed++) jobs.push({ subject, m, seed });
  }
  console.log(`${jobs.length} attacks (${scope}, ${seeds} seed(s), concurrency ${conc})`);
  const pool = new Semaphore(conc);
  const rows: Row[] = [];
  const t0 = Date.now();
  await Promise.all(
    jobs.map(({ subject, m, seed }) =>
      pool.run(async () => {
        const problem = getProblem(subject.problem)!;
        // The reference judges outputs; a same-language one doubles as the replayed fix.
        const ref = refs.get(`${subject.problem}:${subject.language}`)!;
        const refSol: Solution = { language: ref.language, code: ref.code, entry: "solve" };
        const mutant: Solution = { language: subject.language, code: m.code, entry: "solve" };
        const key = `${subject.key}#${m.id}`;
        // Replay explanation for this mutant: the documented reference as the fix.
        fixtures[key] = { explain: `EXPLANATION: Mutant ${m.id} (${m.operator}).\n\n\`\`\`${subject.language}\n${ref.code}\`\`\`` };
        const started = Date.now();
        let row: Row;
        try {
          const r = await attack({ problem, solution: mutant, replayKey: subject.problem, solutionKey: key, seed }, makeDeps({ mode: "replay", fixtures }));
          const base = { key, seed, operator: m.operator, after: m.after, verdict: r.verdict, wallMs: Date.now() - started };
          if (r.verdict === "counterexample" && r.counterexample) {
            const bad = await confirm(problem, refSol, mutant, r.counterexample.args, r.counterexample.expected, r.counterexample.got);
            row = { ...base, outcome: bad ? "unsound" : "killed", detail: bad ?? JSON.stringify(r.counterexample.args).slice(0, 80) };
          } else if (r.verdict === "no_counterexample" || r.verdict === "compile_error") {
            const found = r.verdict === "compile_error" ? null : await search(problem, refSol, mutant, seed);
            row = { ...base, outcome: found ? "missed" : "survived", detail: found ? `differs on ${JSON.stringify(found).slice(0, 80)}` : r.message.slice(0, 80) };
          } else {
            row = { ...base, outcome: "error", detail: r.message.slice(0, 200) };
          }
        } catch (e) {
          row = { key, seed, operator: m.operator, after: m.after, verdict: "crash", outcome: "error", detail: String(e).slice(0, 200), wallMs: Date.now() - started };
        }
        rows.push(row);
        if (row.outcome === "unsound" || row.outcome === "error" || row.outcome === "missed") console.log(`${row.outcome.toUpperCase()} ${key} seed ${seed}: ${row.detail}`);
        if (rows.length % 50 === 0) console.log(`${rows.length}/${jobs.length} done`);
      }),
    ),
  );
  rows.sort((a, b) => a.key.localeCompare(b.key) || a.seed - b.seed);
  const count = (o: Outcome) => rows.filter((r) => r.outcome === o).length;
  const killed = count("killed");
  const summary = {
    attacks: rows.length,
    mutants: new Set(rows.map((r) => r.key)).size,
    seeds,
    killed,
    survived: count("survived"),
    missed: count("missed"),
    unsound: count("unsound"),
    errors: count("error"),
    wallSeconds: Math.round((Date.now() - t0) / 1000),
  };
  const md = [
    `Soak run: ${summary.attacks} attacks on ${summary.mutants} mutants (${scope}), ${seeds} seed(s), replay mode, local executor, ${summary.wallSeconds} s.`,
    "",
    "| Outcome | Count | Meaning |",
    "| --- | --- | --- |",
    `| killed | ${killed} | counterexample reported **and independently confirmed** against the reference solution |`,
    `| unsound | ${summary.unsound} | counterexample reported but not real (must be 0) |`,
    `| survived | ${summary.survived} | no counterexample, and a 3,000-input independent differential search found none either (likely equivalent mutant) |`,
    `| missed | ${summary.missed} | no counterexample, but the independent search found a difference (a real miss) |`,
    `| error | ${summary.errors} | the attack ended in error or budget exhaustion |`,
    "",
    ...(summary.missed ? ["Missed mutants:", "", ...rows.filter((r) => r.outcome === "missed").map((r) => `- \`${r.key}\` seed ${r.seed}: \`${r.after}\` (${r.detail})`), ""] : []),
  ].join("\n");
  const out = join(ROOT, "bench/results");
  mkdirSync(out, { recursive: true });
  const name = all ? "soak-all" : "soak";
  writeFileSync(join(out, `${name}.json`), JSON.stringify({ summary, rows }, null, 2) + "\n");
  writeFileSync(join(out, `${name}.md`), md);
  // Only a clean run may update the README.
  if (args.includes("--readme") && !summary.unsound && !summary.errors) {
    const readme = join(ROOT, "README.md");
    writeFileSync(readme, replaceSection(readFileSync(readme, "utf8"), name, md));
  }
  console.log("\n" + md);
  if (summary.unsound || summary.errors) process.exit(1);
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e);
  process.exit(1);
});
