/** Pure parts of the benchmark (loading subjects, fixtures, summary, Markdown), unit-tested in tests/bench.test.ts. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES } from "../src/fixtures/replay";
import type { Verdict } from "../src/lib/agent/types";
import { RUN_CHUNK } from "../src/lib/agent/stages";
import { chunkLimit, JUDGE0_INPUTS_PER_SUBMISSION } from "../src/lib/exec/judge0";
import type { Language } from "../src/lib/exec/types";
import type { Routing } from "../src/lib/models/config";
import type { ReplayFixtures } from "../src/lib/models/replay";
import { splitHeader } from "../scripts/gen-demos";

export type Subject = { key: string; problem: string; name: string; language: Language; buggy: boolean; bug: string; code: string };

export function loadSubjects(root: string): Subject[] {
  const dir = join(root, "bench/solutions");
  const out: Subject[] = [];
  for (const problem of readdirSync(dir).sort()) {
    for (const file of readdirSync(join(dir, problem)).sort()) {
      const language: Language | null = file.endsWith(".py") ? "python" : file.endsWith(".js") ? "javascript" : null;
      if (!language) throw new Error(`unexpected file in bench/solutions: ${problem}/${file}`);
      const { kind, bug, code } = splitHeader(readFileSync(join(dir, problem, file), "utf8"));
      const name = file.replace(/\.(py|js)$/, "");
      out.push({ key: `${problem}/${name}`, problem, name, language, buggy: kind === "bug", bug, code });
    }
  }
  return out;
}

/**
 * Fixture mode needs an explanation per buggy solution. We replay the bug
 * documented in the solution's header and the problem's correct solution as
 * the fix: that measures the pipeline (oracle, generators, run, shrink,
 * re-attack), not the model's prose.
 */
export function benchFixtures(subjects: Subject[]): ReplayFixtures {
  const fx: ReplayFixtures = { ...FIXTURES };
  for (const s of subjects.filter((x) => x.buggy)) {
    const correct = subjects.find((x) => x.problem === s.problem && !x.buggy);
    if (!correct) throw new Error(`no correct solution for ${s.problem}`);
    fx[s.key] = { explain: `EXPLANATION: ${s.bug}\n\n\`\`\`${s.language}\n${correct.code}\`\`\`` };
  }
  return fx;
}

export type ConfigId = "routed" | "ultra-only" | "random-only";
export type Config = { id: ConfigId; routing: Routing; generators: "model" | "baseline-only"; title: string };

export const CONFIGS: Config[] = [
  { id: "routed", routing: "routed", generators: "model", title: "Routed (Ultra + Super)" },
  { id: "ultra-only", routing: "ultra-only", generators: "model", title: "Ultra only" },
  { id: "random-only", routing: "routed", generators: "baseline-only", title: "Ablation: no model generators (1000 uniform random inputs)" },
];

export type Row = {
  key: string;
  buggy: boolean;
  config: ConfigId;
  verdict: Verdict;
  ttfcMs: number | null;
  costUsd: number;
  unpricedCalls: number;
  modelCalls: number;
  /** Sandbox runs (one program on one input). */
  runs: number;
  /** The problem's per-input time limit, which sets the inputs per Judge0 submission. */
  timeLimitMs: number;
  inputs: number;
  minimal?: unknown[];
  fixVerified?: boolean;
  wallMs: number;
  message: string;
};

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export type Summary = ReturnType<typeof summarise>;

export function summarise(rows: Row[], config: ConfigId) {
  const r = rows.filter((x) => x.config === config);
  const buggy = r.filter((x) => x.buggy);
  const correct = r.filter((x) => !x.buggy);
  const found = buggy.filter((x) => x.verdict === "counterexample");
  const total = r.reduce((a, x) => a + x.costUsd, 0);
  return {
    config,
    buggy: buggy.length,
    found: found.length,
    correct: correct.length,
    falseAlarms: correct.filter((x) => x.verdict === "counterexample").length,
    fixesVerified: found.filter((x) => x.fixVerified).length,
    medianTtfcMs: median(found.flatMap((x) => (x.ttfcMs === null ? [] : [x.ttfcMs]))),
    totalCostUsd: total,
    costPerSolutionUsd: r.length ? total / r.length : 0,
    unpricedCalls: r.reduce((a, x) => a + x.unpricedCalls, 0),
    errors: r.filter((x) => x.verdict === "error" || x.verdict === "budget_exhausted" || x.verdict === "oracle_unreliable").length,
  };
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : "n/a");
const usd = (x: number) => `$${x.toFixed(4)}`;
const sec = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);

export function markdown(rows: Row[], mode: "fixture" | "live", executor: string): string {
  const s = CONFIGS.map((c) => summarise(rows, c.id));
  const row = (label: string, f: (x: Summary) => string) => `| ${label} | ${s.map(f).join(" | ")} |`;
  const head = s[0];
  const n = rows.filter((x) => x.config === "routed").length;
  const lines = [
    `Mode: **${mode}**${mode === "fixture" ? " (replayed model responses; token counts estimated from text length, model latency simulated; execution is real)" : ""}. Executor: ${executor}.`,
    "",
    `| Metric | ${CONFIGS.map((c) => c.title).join(" | ")} |`,
    `| --- | ${CONFIGS.map(() => "---").join(" | ")} |`,
    row(`Bugs found (of ${head?.buggy ?? 0} buggy)`, (x) => `${x.found} (${pct(x.found, x.buggy)})`),
    row(`False alarms (of ${head?.correct ?? 0} correct)`, (x) => `${x.falseAlarms}`),
    row("Fixes verified by re-attack", (x) => `${x.fixesVerified} of ${x.found}`),
    row("Median time to first counterexample (wall clock, varies by about ±0.2 s run to run)", (x) => sec(x.medianTtfcMs)),
    row("Model cost per solution", (x) => usd(x.costPerSolutionUsd)),
    row(`Model cost, all ${n} solutions`, (x) => usd(x.totalCostUsd)),
    ...(s.some((x) => x.unpricedCalls > 0) ? [row("Unpriced model calls (not in cost)", (x) => `${x.unpricedCalls}`)] : []),
    row("Runs ending in error / budget / bad oracle", (x) => `${x.errors}`),
    "",
    loadLine(rows.filter((x) => x.config === "routed")),
    "",
    "| Solution | Expected | Verdict (routed) | Minimal counterexample | Fix verified |",
    "| --- | --- | --- | --- | --- |",
    ...rows
      .filter((x) => x.config === "routed")
      .map((x) => `| \`${x.key}\` | ${x.buggy ? "bug" : "correct"} | ${x.verdict} | ${x.minimal ? `\`${JSON.stringify(x.minimal).slice(0, 60)}\`` : ""} | ${x.fixVerified === undefined ? "" : x.fixVerified ? "yes" : "no"} |`),
  ];
  return lines.join("\n") + "\n";
}

const span = (xs: number[]) => `${Math.min(...xs).toLocaleString("en-US")} to ${Math.max(...xs).toLocaleString("en-US")} (median ${(median(xs) ?? 0).toLocaleString("en-US")})`;

/** Per-attack load of the routed configuration, for the README's "Load and limits". */
export function loadLine(rows: Row[]): string {
  if (!rows.length) return "Load per attack: no runs.";
  // The agent sends at most RUN_CHUNK inputs per program per batch, and Judge0 takes fewer when the time limit is long.
  const perSub = (x: Row) => Math.min(RUN_CHUNK, chunkLimit(JUDGE0_INPUTS_PER_SUBMISSION, x.timeLimitMs));
  return `Load per attack (routed): ${span(rows.map((x) => x.modelCalls))} model calls and ${span(rows.map((x) => x.runs))} sandbox runs, which is at least ${span(rows.map((x) => Math.ceil(x.runs / perSub(x))))} Judge0 submissions (up to ${RUN_CHUNK} inputs each, fewer when a long time limit would not fit Judge0's 15 s CPU cap; smaller shrink batches, timeouts and crashes add more).`;
}

/** Replace the text between <!-- bench:<label>:start --> and <!-- bench:<label>:end --> in a README. */
export function replaceSection(readme: string, label: string, content: string): string {
  const start = `<!-- bench:${label}:start -->\n`;
  const end = `<!-- bench:${label}:end -->`;
  const i = readme.indexOf(start);
  const j = readme.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw new Error(`README.md has no ${start.trim()} ... ${end} markers`);
  return readme.slice(0, i + start.length) + content.trimEnd() + "\n" + readme.slice(j);
}
