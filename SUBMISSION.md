# Counterexample: Devpost submission

**Tagline:** A coding agent that breaks your code before your interviewer does.

**Track:** Coding and Agentic Engineering. Also entering: Best Use of Tavily.

**Links:** repo https://github.com/mlsniperpro/counterexample (MIT) · demo video: _owner to add YouTube link_ · live preview: _owner to add Vercel URL_

## What it does

You paste a problem and a solution: your interview answer, or code an AI wrote. Counterexample does what a strong interviewer or reviewer does:

1. **Understands** the problem as a typed spec. When the statement references external facts, **Tavily** fetches them and every fact is cited in the trace.
2. **Builds an oracle:** Nemotron 3 **Ultra** writes a slow but obviously-correct brute force and must pass the examples before it is trusted.
3. **Attacks:** Nemotron 3 **Super** designs adversarial input *generators* (bounds, duplicates, overflow, degenerate graphs) in a typed DSL.
4. **Runs** the solution and the oracle on thousands of inputs in a sandbox (Judge0-compatible API).
5. **Shrinks** any mismatch to a minimal counterexample with delta debugging.
6. **Explains and fixes:** Ultra explains the bug in two sentences and proposes a fix, which is **re-attacked** before it is called fixed.
7. **Reports** the full trace: every model call (which model and why), every run, cost and latency per step.

## How we used Nebius

**Token Factory and Nemotron.** Every model call goes through Token Factory's OpenAI-compatible API. Ultra handles the two steps where a mistake is expensive (the oracle and the root cause); Super handles the cheap, parallelisable ones (generators, research summaries). The benchmark compares this routing against Ultra everywhere, for cost and time to first counterexample.

**AI Cloud.** The attacked code runs in the Counterexample sandbox (`sandbox/`): one small Judge0-compatible container, deployable as a Nebius Serverless AI endpoint with token auth, so the models run on Token Factory and the code they attack runs on Nebius AI Cloud. We chose an endpoint over Serverless Jobs because jobs have no REST endpoint for reading a job's output and provision a VM per job (`docs/NEBIUS-SANDBOX.md`, `docs/FRICTION.md`).

## How we used Tavily

Research runs when the statement leans on external facts or the user ticks "Research the web". It asks about the problem's sources (official constraints) and about the documentation of risky APIs the code calls, such as JavaScript's `sort()` without a comparator or Python's `round()` (`src/lib/research/plan.ts`). A fact from MDN that numbers sort as strings becomes a generator family of intervals with two-digit starts, which breaks a merge that sorts with plain `sort()`. Every fact must cite a URL from its own search, a generator family may cite only facts from this run's research, and the report lists which families research shaped.

## Results

See the README's benchmark section; every number there is produced by `bench/run.ts`. _Owner: paste the live-mode table after `pnpm bench --live --readme`._

## What's next

Deploying the sandbox endpoint and running the live benchmark (owner steps in `BLOCKED.md`); GitHub PR integration that attacks AI-written functions before merge; more problem families (floating point, interactive problems).

## Team

AlgoCracked.
