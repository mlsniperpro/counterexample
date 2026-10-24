/**
 * Benchmark: 30 known-buggy and 10 correct solutions (bench/solutions), each
 * attacked with routed models (Ultra for oracle + explain, Super for the rest)
 * and with Ultra only. Writes bench/results/<mode>.{json,md} and, with
 * --readme, the results table in README.md. Every README number comes from here.
 *
 *   pnpm bench                 # fixture (replay) mode, no keys needed
 *   pnpm bench --live          # Token Factory + Tavily (needs NEBIUS_API_KEY, TAVILY_API_KEY)
 *   pnpm bench --live --record # also save live responses as replay fixtures
 *   pnpm bench --only isqrt    # one problem
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { attack, type Report } from "../src/lib/agent/run";
import { makeDeps, resolveMode } from "../src/lib/agent/setup";
import { FIXTURES } from "../src/fixtures/replay";
import type { Routing } from "../src/lib/models/config";
import { RecordingProvider, type ReplayFixtures } from "../src/lib/models/replay";
import { getProblem } from "../src/lib/problems/catalog";
import type { Language } from "../src/lib/exec/types";
import { splitHeader } from "../scripts/gen-demos";

type Subject = { key: string; problem: string; name: string; language: Language; buggy: boolean; bug: string; code: string };

const ROOT = join(__dirname, "..");
const args = process.argv.slice(2);
const live = args.includes("--live");
const record = args.includes("--record");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;

export function loadSubjects(root = ROOT): Subject[] {
  const dir = join(root, "bench/solutions");
  const out: Subject[] = [];
  for (const problem of readdirSync(dir).sort()) {
    for (const file of readdirSync(join(dir, problem)).sort()) {
      const { kind, bug, code } = splitHeader(readFileSync(join(dir, problem, file), "utf8"));
      const name = file.replace(/\.(py|js)$/, "");
      out.push({ key: `${problem}/${name}`, problem, name, language: file.endsWith(".py") ? "python" : "javascript", buggy: kind === "bug", bug, code });
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
    const correct = subjects.find((x) => x.problem === s.problem && !x.buggy)!;
    fx[s.key] = { explain: `EXPLANATION: ${s.bug}\n\n\`\`\`${s.language}\n${correct.code}\`\`\`` };
  }
  return fx;
}

type Config = { id: "routed" | "ultra-only" | "random-only"; routing: Routing; generators: "model" | "baseline-only"; title: string };
const CONFIGS: Config[] = [
  { id: "routed", routing: "routed", generators: "model", title: "Routed (Ultra + Super)" },
  { id: "ultra-only", routing: "ultra-only", generators: "model", title: "Ultra only" },
  { id: "random-only", routing: "routed", generators: "baseline-only", title: "Ablation: no model generators (1000 uniform random inputs)" },
];

type Row = { key: string; buggy: boolean; config: Config["id"]; verdict: Report["verdict"]; ttfcMs: number | null; costUsd: number; modelCalls: number; inputs: number; minimal?: unknown[]; fixVerified?: boolean; wallMs: number; message: string };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : "n/a");
const usd = (x: number) => `$${x.toFixed(4)}`;
const sec = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);

export function summarise(rows: Row[], config: Config["id"]) {
  const r = rows.filter((x) => x.config === config);
  const buggy = r.filter((x) => x.buggy);
  const correct = r.filter((x) => !x.buggy);
  const found = buggy.filter((x) => x.verdict === "counterexample");
  return {
    config,
    buggy: buggy.length,
    found: found.length,
    correct: correct.length,
    falseAlarms: correct.filter((x) => x.verdict === "counterexample").length,
    fixesVerified: found.filter((x) => x.fixVerified).length,
    medianTtfcMs: median(found.map((x) => x.ttfcMs!).filter((x) => x !== null)),
    totalCostUsd: r.reduce((a, x) => a + x.costUsd, 0),
    costPerSolutionUsd: r.length ? r.reduce((a, x) => a + x.costUsd, 0) / r.length : 0,
    errors: r.filter((x) => x.verdict === "error" || x.verdict === "budget_exhausted" || x.verdict === "oracle_unreliable").length,
  };
}

function markdown(rows: Row[], mode: string, executor: string): string {
  const s = CONFIGS.map((c) => summarise(rows, c.id));
  const row = (label: string, f: (x: (typeof s)[number]) => string) => `| ${label} | ${s.map(f).join(" | ")} |`;
  const n = rows.filter((x) => x.config === "routed").length;
  const lines = [
    `Mode: **${mode}**${mode === "fixture" ? " (replayed model responses; token counts estimated from text length, model latency simulated; execution is real)" : ""}. Executor: ${executor}.`,
    "",
    `| Metric | ${CONFIGS.map((c) => c.title).join(" | ")} |`,
    `| --- | ${CONFIGS.map(() => "---").join(" | ")} |`,
    row(`Bugs found (of ${s[0].buggy} buggy)`, (x) => `${x.found} (${pct(x.found, x.buggy)})`),
    row(`False alarms (of ${s[0].correct} correct)`, (x) => `${x.falseAlarms}`),
    row("Fixes verified by re-attack", (x) => `${x.fixesVerified} of ${x.found}`),
    row("Median time to first counterexample", (x) => sec(x.medianTtfcMs)),
    row("Model cost per solution", (x) => usd(x.costPerSolutionUsd)),
    row(`Model cost, all ${n} solutions`, (x) => usd(x.totalCostUsd)),
    row("Runs ending in error / budget / bad oracle", (x) => `${x.errors}`),
    "",
    "| Solution | Expected | Verdict (routed) | Minimal counterexample | Fix verified |",
    "| --- | --- | --- | --- | --- |",
    ...rows
      .filter((x) => x.config === "routed")
      .map((x) => `| \`${x.key}\` | ${x.buggy ? "bug" : "correct"} | ${x.verdict} | ${x.minimal ? `\`${JSON.stringify(x.minimal).slice(0, 60)}\`` : ""} | ${x.fixVerified === undefined ? "" : x.fixVerified ? "yes" : "no"} |`),
  ];
  return lines.join("\n") + "\n";
}

async function main() {
  const mode = resolveMode(process.env, live ? "live" : "replay");
  if (live && mode !== "live") throw new Error("--live needs NEBIUS_API_KEY");
  const subjects = loadSubjects().filter((s) => !only || s.problem === only);
  const fixtures = benchFixtures(subjects);
  const rows: Row[] = [];
  let recorded: ReplayFixtures = {};
  let executorLabel = "";
  for (const config of CONFIGS) {
    for (const s of subjects) {
      const deps = makeDeps({ mode, routing: config.routing, fixtures });
      executorLabel = deps.executor.label;
      const rec = record && mode === "live" ? new RecordingProvider(deps.provider) : null;
      if (rec) deps.provider = rec;
      const problem = getProblem(s.problem)!;
      const r = await attack(
        { problem, solution: { language: s.language, code: s.code, entry: "solve" }, replayKey: s.problem, solutionKey: s.key, generators: config.generators },
        deps,
      );
      if (rec) recorded = { ...recorded, ...rec.recorded };
      const row: Row = {
        key: s.key,
        buggy: s.buggy,
        config: config.id,
        verdict: r.verdict,
        ttfcMs: r.stats.timeToFirstCounterexampleMs,
        costUsd: r.stats.costUsd,
        modelCalls: r.stats.modelCalls,
        inputs: r.stats.inputsTested,
        minimal: r.counterexample?.args,
        fixVerified: r.fix?.verified,
        wallMs: r.stats.wallMs,
        message: r.message,
      };
      rows.push(row);
      const ok = s.buggy ? r.verdict === "counterexample" : r.verdict === "no_counterexample";
      console.log(`${ok ? "ok  " : config.id === "random-only" ? "miss" : "MISS"} ${config.id.padEnd(11)} ${s.key.padEnd(36)} ${r.verdict.padEnd(18)} ${row.minimal ? JSON.stringify(row.minimal).slice(0, 50) : ""}`);
    }
  }
  const label = mode === "live" ? "live" : "fixture";
  const outDir = join(ROOT, "bench/results");
  mkdirSync(outDir, { recursive: true });
  const md = markdown(rows, label, executorLabel);
  if (!only) {
    writeFileSync(join(outDir, `${label}.json`), JSON.stringify({ mode: label, executor: executorLabel, summary: CONFIGS.map((c) => summarise(rows, c.id)), rows }, null, 2) + "\n");
    writeFileSync(join(outDir, `${label}.md`), md);
    if (args.includes("--readme")) {
      const readme = readFileSync(join(ROOT, "README.md"), "utf8");
      const tag = `bench:${label}`;
      const re = new RegExp(`(<!-- ${tag}:start -->\\n)[\\s\\S]*?(<!-- ${tag}:end -->)`);
      if (!re.test(readme)) throw new Error(`README.md has no <!-- ${tag}:start/end --> markers`);
      writeFileSync(join(ROOT, "README.md"), readme.replace(re, `$1${md.split("\n\n| Solution")[0]}\n$2`));
    }
  }
  if (record && Object.keys(recorded).length) {
    writeFileSync(join(outDir, "recorded-fixtures.json"), JSON.stringify(recorded, null, 2) + "\n");
  }
  console.log("\n" + md);
}

if (process.argv[1]?.endsWith("run.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
