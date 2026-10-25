# Counterexample: Devpost submission

**Tagline:** A coding agent that breaks your code before your interviewer does.

**Track:** Coding and Agentic Engineering. Also entering: Best Use of Tavily.

**Links:** repo https://github.com/mlsniperpro/counterexample (MIT) · demo video: _owner to add YouTube link_ · live preview: _owner to add Vercel URL_

## What it does

You paste a problem and a solution: your interview answer, or code an AI wrote. Counterexample does what a strong interviewer or reviewer does:

1. **Understands** the problem as a typed spec. When the statement references external facts, **Tavily** fetches them and every fact is cited in the trace.
2. **Builds an oracle:** Nemotron 3 **Ultra** writes a slow but obviously-correct brute force and must pass the examples before it is trusted.
3. **Attacks:** Nemotron 3 **Super** designs adversarial input *generators* (bounds, duplicates, overflow, worst-case sizes, long chains) in a typed DSL, on top of deterministic small-scope exhaustive and mutation families.
4. **Runs** the solution and the oracle on thousands of inputs in a sandbox (Judge0-compatible API).
5. **Confirms and shrinks:** a mismatch counts only once it reproduces on a fresh run, then delta debugging shrinks it to a minimal counterexample.
6. **Explains and fixes:** Ultra explains the bug in two sentences and proposes a fix, which is **re-attacked** before it is called fixed.
7. **Reports** the full trace: every model call (which model and why), every run, cost and latency per step.

## How we used Nebius

**Token Factory and Nemotron.** Every model call goes through Token Factory's OpenAI-compatible API. Ultra handles the two steps where a mistake is expensive (the oracle and the root cause); Super handles the cheap, parallelisable ones (generators, research summaries). The benchmark compares this routing against Ultra everywhere, for cost and time to first counterexample.

**AI Cloud.** The attacked code runs in the Counterexample sandbox (`sandbox/`): one small Judge0-compatible container, deployable as a Nebius Serverless AI endpoint with token auth, so the models run on Token Factory and the code they attack runs on Nebius AI Cloud. We chose an endpoint over Serverless Jobs because jobs have no REST endpoint for reading a job's output and provision a VM per job (`docs/NEBIUS-SANDBOX.md`, `docs/FRICTION.md`).

## How we used Tavily

Research runs when the statement leans on external facts or the user ticks "Research the web". It asks about the problem's sources (official constraints) and about the documentation of risky APIs the code calls, such as JavaScript's `sort()` without a comparator or Python's `round()` (`src/lib/research/plan.ts`). A fact from MDN that numbers sort as strings becomes a generator family of intervals with two-digit starts, which breaks a merge that sorts with plain `sort()`. Every fact must cite a URL from its own search, a generator family may cite only facts from this run's research, and the report lists which families research shaped.

## Results

Every number below is produced by `bench/run.ts` (`pnpm bench --readme`) in replay mode: recorded model answers that we wrote, with real execution. They measure the pipeline, not Nemotron's judgement, until the live run. _Owner: paste the live-mode table after `pnpm bench --live --readme`._

- **54 solutions** in 13 problems: 38 known-buggy (each documents its bug) and 16 correct, in Python and JavaScript. The agent finds **38 of 38** with **0 false alarms**, and every proposed fix is verified by re-attack.
- **Where the models matter.** We ran two ablations under the same budgets. On the 30 base-tier bugs, the deterministic families alone (small-scope exhaustive, mutations, random) already find all 30. On the 8 hard-tier bugs, which show only at worst-case sizes or on specific structure (exponential backtracking on a long unsplittable run, a memo that forgets failures, a modulus applied too late, a distance array that overflows on a long chain), **the model-designed families (recorded answers in replay; Nemotron Super writes them live) find 8 of 8, and both ablations find 0 of 8.**
- **Soak.** Hundreds of single-point mutants of every solution are attacked, and every claimed counterexample is checked against a reference solution: 0 false claims and 0 misses.

## What's next

Deploying the sandbox endpoint and running the live benchmark (owner steps in `BLOCKED.md`); GitHub PR integration that attacks AI-written functions before merge; more problem families (floating point, interactive problems).

## Team

AlgoCracked.
