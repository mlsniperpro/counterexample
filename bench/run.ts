/**
 * Benchmark: 30 known-buggy and 10 correct solutions (bench/solutions), each
 * attacked with routed models (Ultra for oracle + explain, Super for the
 * rest), with Ultra only, and with no model generators (ablation). Writes
 * bench/results/<mode>.{json,md} and, with --readme, the results table in
 * README.md. Every README number comes from here.
 *
 *   pnpm bench                 # fixture (replay) mode, no keys needed
 *   pnpm bench --live          # Token Factory + Tavily (needs NEBIUS_API_KEY, TAVILY_API_KEY)
 *   pnpm bench --live --record # also save live responses as replay fixtures
 *   pnpm bench --only isqrt    # one problem, nothing written
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { attack } from "../src/lib/agent/run";
import { showValue } from "../src/lib/core/compare";
import { makeDeps, resolveMode } from "../src/lib/agent/setup";
import { RecordingProvider, type ReplayFixtures } from "../src/lib/models/replay";
import { getProblem } from "../src/lib/problems/catalog";
import { benchFixtures, CONFIGS, loadSubjects, markdown, replaceSection, summarise, type Row } from "./lib";

const ROOT = join(__dirname, "..");

async function main(args: string[]) {
  const live = args.includes("--live");
  const record = args.includes("--record");
  const onlyAt = args.indexOf("--only");
  const only = onlyAt >= 0 ? args[onlyAt + 1] : undefined;
  if (onlyAt >= 0 && !only) throw new Error("--only needs a problem id");

  const mode = resolveMode(process.env, live ? "live" : "replay");
  if (live && !process.env.NEBIUS_API_KEY) throw new Error("--live needs NEBIUS_API_KEY");
  const subjects = loadSubjects(ROOT).filter((s) => !only || s.problem === only);
  if (subjects.length === 0) throw new Error(`no subjects match --only ${only}`);
  const fixtures = benchFixtures(subjects);
  const rows: Row[] = [];
  const recorded: ReplayFixtures = {};
  let executorLabel = "";
  for (const config of CONFIGS) {
    for (const s of subjects) {
      const deps = makeDeps({ mode, routing: config.routing, fixtures });
      executorLabel = deps.executor.label;
      const rec = record && mode === "live" ? new RecordingProvider(deps.provider) : null;
      if (rec) deps.provider = rec;
      const problem = getProblem(s.problem);
      if (!problem) throw new Error(`bench/solutions/${s.problem} has no problem in the catalog`);
      const r = await attack(
        { problem, solution: { language: s.language, code: s.code, entry: "solve" }, replayKey: s.problem, solutionKey: s.key, generators: config.generators },
        deps,
      );
      if (rec) Object.assign(recorded, rec.recorded);
      rows.push({
        key: s.key,
        buggy: s.buggy,
        config: config.id,
        verdict: r.verdict,
        ttfcMs: r.stats.timeToFirstCounterexampleMs,
        costUsd: r.stats.costUsd,
        unpricedCalls: r.stats.unpricedCalls,
        modelCalls: r.stats.modelCalls,
        runs: r.stats.runs,
        timeLimitMs: problem.timeLimitMs,
        inputs: r.stats.inputsTested,
        minimal: r.counterexample?.args,
        foundBy: r.counterexample?.original.family,
        foundByModel: r.counterexample ? r.families.find((f) => f.name === r.counterexample?.original.family)?.source === "model" : undefined,
        fixVerified: r.fix?.verified,
        wallMs: r.stats.wallMs,
        message: r.message,
      });
      const ok = s.buggy ? r.verdict === "counterexample" : r.verdict === "no_counterexample";
      const tag = ok ? "ok  " : config.id === "random-only" || config.id === "no-model" ? "miss" : "MISS";
      console.log(`${tag} ${config.id.padEnd(11)} ${s.key.padEnd(36)} ${r.verdict.padEnd(18)} ${r.counterexample ? JSON.stringify(r.counterexample.args).slice(0, 50) : ""}`);
    }
  }
  const label = mode === "live" ? "live" : "fixture";
  const md = markdown(rows, label, executorLabel);
  if (!only) {
    const outDir = join(ROOT, "bench/results");
    mkdirSync(outDir, { recursive: true });
    const summary = CONFIGS.map((c) => summarise(rows, c.id));
    writeFileSync(join(outDir, `${label}.json`), showValue({ mode: label, executor: executorLabel, summary, rows }, 2) + "\n");
    writeFileSync(join(outDir, `${label}.md`), md);
    if (args.includes("--readme")) {
      const readmePath = join(ROOT, "README.md");
      writeFileSync(readmePath, replaceSection(readFileSync(readmePath, "utf8"), label, md.split("\n\n| Solution")[0] ?? md));
    }
  }
  if (record && Object.keys(recorded).length) writeFileSync(join(ROOT, "bench/results/recorded-fixtures.json"), JSON.stringify(recorded, null, 2) + "\n");
  console.log("\n" + md);
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e);
  process.exit(1);
});
