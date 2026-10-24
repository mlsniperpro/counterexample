# Counterexample

**License: MIT** · Built for the Nebius x NVIDIA Global AI Hackathon (Coding and Agentic Engineering track)

**A coding agent that doesn't stop at "tests pass".** Give it a problem and a solution (your interview answer, or code an AI wrote). It does what a strong interviewer does: builds a slow but obviously-correct oracle, designs adversarial inputs, runs thousands of them in a sandbox, shrinks any mismatch to a **minimal counterexample**, explains the bug in two sentences, proposes a fix, and **re-attacks the fix** before calling it fixed.

```
solve([0], 0)          expected 0, got -1            binary search, loop exits at lo == hi
solve(2147483647)      expected 46340, got 0         integer sqrt, (lo + hi + 1) >> 1 overflows
solve([2, 3], 4)       expected 2, got -1            coin change, greedy
solve("baab")          expected 2, got 3             sliding window moves backwards
```

## How it uses Nebius Token Factory and NVIDIA Nemotron

| Step | Model | Why |
| --- | --- | --- |
| Oracle (brute-force reference) | **Nemotron 3 Ultra** | A wrong oracle means false alarms, so correctness beats latency. It must pass the statement's examples before it is trusted. |
| Adversarial generators | **Nemotron 3 Super** (or Nano) | Generator families are cheap to try and are checked by a typed DSL and the problem's constraints, so speed wins. |
| Research summary (Tavily) | Super | Extracting cited facts from search results is extraction, not deep reasoning. |
| Explain + fix | **Nemotron 3 Ultra** | Root-causing a bug from one minimal input needs deep reasoning. |

All calls go through Token Factory's OpenAI-compatible endpoint (`NEBIUS_BASE_URL`, `NEBIUS_API_KEY`, `MODEL_REASONING`, `MODEL_FAST`). The report's **"Why Ultra here, Super there"** panel shows model, tokens, cost and latency for every step, and the benchmark compares this routing with an Ultra-only baseline.

**Tavily** runs only when the statement leans on external facts (for example "constraints follow LeetCode 704"). Facts come back with URLs, are cited in the trace, and the trace shows which generator families they shaped.

## Design choices that matter

- **Generators, not test cases.** The fast model writes input *families* in a small JSON DSL (`src/lib/core/spec.ts`): ints with edge bias, arrays (sorted, distinct, duplicate pools), strings, tuples, DAGs as edge lists. Model output is interpreted, never executed, and every generated input is checked against the problem's declared constraints, so an over-eager generator cannot cause a false alarm.
- **Delta debugging over structured inputs** (`src/lib/core/shrink.ts`): chunk removal, element simplification, binary search on integers, isolated-node removal with relabelling for graphs. A well-founded size measure guarantees termination; the problem's validator keeps every step legal.
- **One harness, any sandbox.** Code is wrapped in the same JSON-lines harness for every executor (`src/lib/exec/program.ts`). If one input hangs or crashes, the next unreported input is blamed and the batch restarts after it, so one bad input never loses the rest.
- **Budgets and an honest verdict.** Model calls, sandbox runs and wall clock are budgeted per attack. If the oracle never matches the examples, the verdict is `oracle_unreliable` and **no bug is claimed**. If nothing breaks, the report says "evidence, not proof".
- **Deterministic replay.** `ReplayProvider` serves recorded responses, so the whole loop runs in tests and for judges without a key. `pnpm bench --live --record` turns a live run into new fixtures.

![Architecture](docs/architecture.svg)

## Benchmark

`bench/solutions/` holds 10 problems with 30 known-buggy solutions (each file's first line documents the bug) and 10 correct ones. `pnpm bench --readme` reruns everything and rewrites the table below; **every number here comes from that script** (`bench/run.ts`, full per-solution results in `bench/results/`).

### Fixture mode (replayed model responses, real execution)

<!-- bench:fixture:start -->
Mode: **fixture** (replayed model responses; token counts estimated from text length, model latency simulated; execution is real). Executor: Local subprocess (dev only, not sandboxed).

| Metric | Routed (Ultra + Super) | Ultra only | Ablation: no model generators (1000 uniform random inputs) |
| --- | --- | --- | --- |
| Bugs found (of 30 buggy) | 30 (100%) | 30 (100%) | 27 (90%) |
| False alarms (of 10 correct) | 0 | 0 | 0 |
| Fixes verified by re-attack | 30 of 30 | 30 of 30 | 27 of 27 |
| Median time to first counterexample | 4.8 s | 10.1 s | 2.3 s |
| Model cost per solution | $0.0014 | $0.0026 | $0.0008 |
| Model cost, all 40 solutions | $0.0551 | $0.1045 | $0.0336 |
| Runs ending in error / budget / bad oracle | 0 | 0 | 0 |
<!-- bench:fixture:end -->

How to read this honestly:

- In fixture mode the generator families and oracles are **recorded responses we wrote**, knowing the bug classes. These numbers measure the pipeline (oracle check, generation, sandbox runs, shrinking, re-attack), not Nemotron's judgement. Token counts are estimated from text length and model latency is simulated, so time-to-first-counterexample is dominated by simulated latency (Ultra is slower per token, which is why Ultra-only is slower).
- The ablation row is the useful one: **uniform random inputs alone already find most of these bugs**. The ones they miss are exactly the ones that need targeted inputs: the int32 midpoint overflow (only `x = 2^31 - 1`), the `x = 0 / 1` bound in integer sqrt, and crossed brackets like `([)]`.

### Live mode (Token Factory + Tavily)

<!-- bench:live:start -->
**Pending a key (see `BLOCKED.md`).** No `NEBIUS_API_KEY` / `TAVILY_API_KEY` was available in the build session, and the session's network policy blocked `api.tokenfactory.nebius.com` (see `docs/FRICTION.md`). Run `pnpm bench --live --readme` to fill this section.
<!-- bench:live:end -->

## Run it

```bash
pnpm install
pnpm test                 # shrinker, generators, executors, budgets, replay end to end
pnpm dev                  # http://localhost:3000, replay mode without keys
pnpm bench                # fixture-mode benchmark (Python 3 and Node needed for the local executor)
```

Live mode: copy `.env.example` to `.env.local` and set `NEBIUS_API_KEY` (plus `TAVILY_API_KEY` for research). Confirm the model ids against Token Factory's model list first.

Sandbox: set `JUDGE0_URL` (and `JUDGE0_TOKEN`, or `JUDGE0_RAPIDAPI_HOST` for RapidAPI) to run code on any Judge0-compatible API. Without it the **local executor** runs Python/JS as subprocesses with time and memory limits. **It is for development only: it is not a security sandbox**, and production refuses it unless `ALLOW_LOCAL_EXECUTOR=1`.

Deployment: a Vercel preview works for the UI; set the env vars above. `/api/attack` is rate-limited per IP (`RATE_LIMIT_PER_HOUR`) and stops calling models once `DAILY_SPEND_CAP_USD` is spent (both in-memory, per instance).

## Layout

```
src/lib/core      input DSL, seeded RNG, comparison, shrinker
src/lib/exec      Executor interface, harness, Judge0Executor, LocalExecutor
src/lib/models    Token Factory client, replay + recording providers, routing, pricing
src/lib/agent     stages (run.ts), prompts, parsers, budgets, trace, setup, guards
src/lib/research  Tavily client and research trigger
src/fixtures      replay fixtures for the 10 problems
src/app           Next.js UI and /api/attack (NDJSON stream)
bench/            solutions, benchmark script, results
docs/             FEEDBACK, FRICTION, VIDEO shot list, architecture.svg
```

Built by the AlgoCracked team. Interview prep is the first use; attacking AI-written code before you merge it is the everyday one.
