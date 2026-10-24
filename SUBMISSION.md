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

## How we used Nebius Token Factory and Nemotron

Every model call goes through Token Factory's OpenAI-compatible API. Ultra handles the two steps where a mistake is expensive (the oracle and the root cause); Super handles the cheap, parallelisable ones (generators, research summaries). The benchmark compares this routing against Ultra everywhere, for cost and time to first counterexample.

## Results

See the README's benchmark section; every number there is produced by `bench/run.ts`. _Owner: paste the live-mode table after `pnpm bench --live --readme`._

## What's next

A Nebius Serverless Jobs executor for large batch attacks; GitHub PR integration that attacks AI-written functions before merge; more problem families (floating point, interactive problems).

## Team

AlgoCracked.
