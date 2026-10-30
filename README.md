# Counterexample

**License: MIT** · Built for the Nebius x NVIDIA Global AI Hackathon (Coding and Agentic Engineering track)

**A coding agent that doesn't stop at "tests pass".** Give it a problem and a solution (your interview answer, or code an AI wrote). It does what a strong interviewer does: builds a slow but obviously-correct oracle, designs adversarial inputs, runs them in a sandbox (up to a few hundred before the first counterexample, hundreds to over a thousand when nothing breaks), and hundreds to over a thousand more on the fix (thousands of sandbox runs, counting the oracle), shrinks any mismatch to a **minimal counterexample**, explains the bug in two sentences, proposes a fix, and **re-attacks the fix** before calling it fixed.

## Try it in 60 seconds (no keys needed)

```bash
pnpm install
pnpm dev          # open http://localhost:3000 and press "Attack this solution"
```

Without keys the app runs in **replay mode**: hand-written stand-ins for model answers are served, while every program run is real. The five built-in problems each carry a subtly buggy solution. Each attack ends in a minimal counterexample, a two-sentence explanation, and a fix that has been re-attacked; "Share link" puts the report (without its trace) into a URL. With keys, the same UI is built to run live on Nebius Token Factory (see "Run it"; not yet run with a key, see `BLOCKED.md`).

What it found in the built-in solutions:

```
solve([0], 0)                           expected 0, got -1                binary search, loop exits at lo == hi
solve(2147483647)                       expected 46340, got 0             integer sqrt, (lo + hi + 1) >> 1 overflows
solve([2, 5], 6)                        expected 3, got -1                coin change, greedy
solve("baab")                           expected 2, got 3                 sliding window moves backwards
solve(3, [[0,1,1],[1,2,-2],[0,2,0]])    expected [0,1,-1], got [0,1,0]    Dijkstra, negative edge
```

These are the replay-mode results, with hand-written stand-ins for the models (the same counterexamples with or without "Research the web" ticked). Which stage catches each one first: the deterministic small-scope family finds the binary search, the square root and the coin change (shrunk from `[[2, 19], 24]` in 4 steps). For the coin change, research shaped a `non-canonical-systems` family, but small-scope fails first and the run moves on to shrinking, so that family never runs. The sliding window and the Dijkstra are different: small-scope tried 40 and 105 inputs and found nothing, and the model-designed families `two-letter-alphabet` and `negative-shortcut` (both shaped by the cited research when "Research the web" is ticked) found them (the Dijkstra one shrinks from four edges to three in 2 steps).

## How it uses Nebius Token Factory and NVIDIA Nemotron

| Step | Model | Why |
| --- | --- | --- |
| Oracle (brute-force reference) | **Nemotron 3 Ultra** | A wrong oracle means false alarms, so correctness beats latency. It must pass the statement's examples before it is trusted. |
| Adversarial generators | **Nemotron 3 Super** (or Nano) | Generator families are cheap to try and are checked by a typed DSL and the problem's constraints, so speed wins. |
| Research summary (Tavily) | Super | Extracting cited facts from search results is extraction, not deep reasoning. |
| Explain + fix | **Nemotron 3 Ultra** | Root-causing a bug from one minimal input needs deep reasoning. |

All calls go through Token Factory's OpenAI-compatible endpoint (`NEBIUS_BASE_URL`, `NEBIUS_API_KEY`, `MODEL_REASONING`, `MODEL_FAST`). The report's **"Why Ultra here, Super there"** panel shows model, tokens, cost and latency for every step, and the benchmark compares this routing with an Ultra-only baseline.

**Tavily** research runs when the statement leans on external facts or the user ticks **Research the web**. When it runs, it answers two kinds of question, and every answer becomes cited facts that steer the attack:

- **The problem's sources.** For example "constraints follow LeetCode 704": Tavily fetches the official constraints.
- **The documentation of risky APIs the code calls.** The agent reads the code for calls whose documented behaviour is a classic bug source:
  - JavaScript's `sort()` without a comparator sorts numbers as strings;
  - `>>`, `|` and `~~` truncate to 32 bits;
  - `Math.round` rounds rather than floors;
  - Python's `round()` sends halves to the even neighbour.

  It then searches their docs, so MDN's sentence "numbers are converted to strings, '80' comes before '9'" turns into a generator family of two-digit intervals that breaks the merge.

  When research is not requested, the trace suggests it whenever the code calls one of these APIs.

Every fact carries its URL into the trace and the report. A generator family may cite only facts from this run's research, and the report lists which families the research shaped (`src/lib/research/plan.ts`).

**Share a report by link.** "Share link" puts the report (without its trace) into the URL fragment, deflate-compressed and base64url-encoded with the browser's own Compression Streams API. Browsers never send the fragment to the server, so opening the link decodes the report in the reader's browser, after size caps and schema validation. The whole link (origin, path and fragment) is capped at 8,000 characters, the minimum URI length RFC 9110 asks software to support; a larger report is downloaded as JSON instead, with the same content a link would carry.

## Design choices that matter

- **Generators, not test cases.** The fast model writes input *families* in a small JSON DSL (`src/lib/core/spec.ts`): ints with edge bias, arrays (sorted, distinct, duplicate pools), strings, tuples, DAGs as edge lists. Model output is interpreted, never executed, and every generated input is checked against the problem's declared constraints, so an over-eager generator cannot break a constraint the spec states. Constraints the DSL cannot state are listed under "Your own code" below.
- **Deep graphs on request.** A graph family may set `shape: "path"`: its first edges then form the chain 0 → 1 → … → n−1 (as far as its edge count allows) and the rest stay random. Random edges almost never make a long chain (on 1,000 nodes and 10,000 random edges the longest path is 37 to 50 edges in 20 seeded samples, median 43; `pnpm exec tsx bench/longest-path.ts`), so without it a generator could not ask for the deepest graph a problem allows. Sizes stay under the same DSL caps.
- **Small scope first.** Right after the examples, a bounded-exhaustive family runs every small input of the declared types. That means all integers near zero plus the bounds, all short strings and arrays over a few values, and all small graphs with up to two edges. When there are more of them than the family's cap of 300, they are sampled evenly across the whole enumeration (not cut off after a prefix), and the report says how many were kept (for binary search, 300 of 371). This follows the small-scope hypothesis that most bugs have a small counterexample, and it catches bugs random sampling skips (a solution wrong only at `x = 5` out of 2^31).
- **Mutation on top of generation.** After the model's families, type-aware mutants of the examples and of every input already tried (±1, negation, duplicated or dropped elements, swaps, repeated slices) run as their own family, in the manner of EvalPlus (the type-aware input mutation of Liu et al., 2023). They are filtered by the same validator.
- **Delta debugging over structured inputs** (`src/lib/core/shrink.ts`): chunk removal, element simplification, binary search on integers, isolated-node removal with relabelling for graphs (all isolated nodes at once, then half of them, then one at a time, so a 1,000-node graph with a few edges shrinks in a few rounds). Adjacent pairs are removed at every offset, so crossed brackets like `({())}` shrink to `({)}`. A well-founded size measure guarantees termination; the problem's validator keeps every step legal. Shrinking gets at most half of the wall clock left when it starts and then keeps the smallest failing input found so far, so the explanation, fix and re-attack still run; a hang shrinks two candidates at a time, since each one that still hangs costs a full time limit. If the shrink budget or its time share runs out first, the report says the input may not be minimal. "Minimal" here is the property-testing sense: no single reduction step (a smaller integer from the binary search, a removed chunk, a simplified element) still fails. For a non-monotone integer rule — a divisibility or calendar bug, say, where only some values fail — a smaller *unrelated* failing integer can still exist that no reduction reaches; the result is the smallest the reductions find, not a proof that nothing smaller fails.
- **One harness, any sandbox.** Code is wrapped in the same JSON-lines harness for every executor (`src/lib/exec/program.ts`). If one input hangs or crashes, the next unreported input is blamed and the batch restarts after it, so one bad input never loses the rest. Judge0 has one time limit per submission, so there an input is blamed for a timeout only after it also times out alone, and a submission never holds more inputs than fit their full limits in Judge0's 15 s CPU cap.
- **Budgets and an honest verdict.** Model calls, sandbox runs and wall clock are budgeted per attack. If the oracle never matches the examples, the verdict is `oracle_unreliable` and **no bug is claimed**. A mismatch counts only after it reproduces on a fresh re-run; each checked mismatch is re-run alone in its own process, and one that does not reproduce (an overloaded sandbox, say) is dropped with a warning in the trace and the attack goes on. If none reproduces alone but the same inputs fail again when re-run in their original order (split over processes as the first run was, unless its results were too large for one run) and the oracle answers them the same in order as alone, the failure is deterministic and order-dependent (the solution keeps state between calls, such as a memo keyed wrongly or a mutable default argument): that is reported as a counterexample marked as such, not shrunk, and not called flaky. An oracle that answers differently in order is named in the trace, and nothing is blamed on the solution. Outputs are compared as JSON values: object key order does not matter, and integers beyond 2^53 are compared by their exact digits, so an overflow in the last digit is still caught. Two integers must always match exactly; where either side of a pair is not an integer (a float answer), the usual judge tolerance applies (absolute or relative error 1e-6), so a correct answer computed in another order or approximated by bisection is not called a bug. A problem marked `float` also gives integers from 2^50 that tolerance. JSON cannot tell an integer-valued float from an integer (Python's `4503655453206022.0` reads as `4503655453206022`), so in a problem not marked `float`, two such answers beyond 2^50 that differ by rounding count as different; mark the problem `float`, or write an example output with a decimal point, for averages of huge numbers. If nothing breaks, the report says "evidence, not proof".
- **Robust at the edges.** Every external input is schema-validated with zod: the API body, every model answer (generator families, research facts, problem specs), and every Token Factory, Tavily and Judge0 response. Network calls have per-attempt timeouts, bounded retries with full-jitter backoff (honouring `Retry-After`) and an idempotency key. Failures are typed errors (`src/lib/errors.ts`). Nothing falls back silently: a failed search, a rejected family, an unpriced model or an unverified fix each show up in the trace and the report.
- **Deterministic replay.** `ReplayProvider` serves the hand-written stand-in responses in `src/fixtures/replay.ts`, so the whole loop runs in tests and for judges without a key. `pnpm bench --live --record` writes the live responses to `bench/results/recorded-fixtures.json`, for manual merge into `src/fixtures/replay.ts`.

![Architecture](docs/architecture.svg)

## Benchmark

`bench/solutions/` holds 13 problems with 38 known-buggy solutions (each file's first line documents the bug) and 16 correct ones, in two tiers. The **base tier** (10 problems, 30 buggy, 10 correct) has small inputs. The **hard tier** (`bench/solutions/hard/`: word break, decode ways and shortest paths in a 1,000-node DAG; 8 buggy and 6 correct, in Python and JavaScript) holds bugs that only show at worst-case sizes or on specific structure: exponential backtracking on a long run of one letter that cannot be split, a memo that forgets failures or treats a cached 0 as missing, a modulus applied only at the end (counts past 2^53), and an `INF = 10**9` sentinel or an `Int32Array` that overflows on a long chain of heavy edges. Every configuration runs with the same budgets and seeds. `pnpm bench --readme` reruns everything and rewrites the table below; **every number here comes from that script** (`bench/run.ts`, full per-solution results in `bench/results/`).

### Fixture mode (hand-written stand-ins for model answers, real execution)

<!-- bench:fixture:start -->
Mode: **fixture** (replayed hand-written stand-ins for model answers; token counts estimated from text length, model latency simulated; execution is real). In fixture mode, each benchmark "fix" is the problem's correct reference solution, so "Fixes verified" is a pipeline check, not fix quality. Executor: Local subprocess (dev only, not sandboxed).

| Metric | Routed (Ultra + Super) | Ultra only | Ablation: no model families (examples, small-scope, mutations, random) | Ablation: examples + 1000 uniform random inputs only |
| --- | --- | --- | --- | --- |
| Bugs found (of 38 buggy) | 38 (100%) | 38 (100%) | 30 (79%) | 27 (71%) |
| False alarms (of 16 correct) | 0 | 0 | 0 | 0 |
| Fixes verified by re-attack | 38 of 38 | 38 of 38 | 30 of 30 | 27 of 27 |
| Bugs first found by a model-designed family | 13 | 13 | 0 | 0 |
| Median time to first counterexample (execution plus simulated model latency; varies by about ±0.5 s run to run, more on a loaded machine) | 5.5 s | 11.3 s | 2.5 s | 2.5 s |
| Model cost per solution | $0.0016 | $0.0032 | $0.0008 | $0.0008 |
| Model cost, all 54 solutions | $0.0882 | $0.1725 | $0.0433 | $0.0419 |
| Runs ending in error / budget / bad oracle | 0 | 0 | 0 | 0 |

**Base tier only** (`bench/solutions/<problem>/`: 30 buggy, 10 correct; same budgets and seeds as above):

| Metric | Routed (Ultra + Super) | Ablation: no model families (examples, small-scope, mutations, random) | Ablation: examples + 1000 uniform random inputs only |
| --- | --- | --- | --- |
| Bugs found (of 30 buggy) | 30 (100%) | 30 (100%) | 27 (90%) |
| False alarms (of 10 correct) | 0 | 0 | 0 |
| Fixes verified by re-attack | 30 of 30 | 30 of 30 | 27 of 27 |
| Bugs first found by a model-designed family | 5 | 0 | 0 |
| Runs ending in error / budget / bad oracle | 0 | 0 | 0 |

**Hard tier only** (`bench/solutions/hard/<problem>/`: 8 buggy, 6 correct; same budgets and seeds as above):

| Metric | Routed (Ultra + Super) | Ablation: no model families (examples, small-scope, mutations, random) | Ablation: examples + 1000 uniform random inputs only |
| --- | --- | --- | --- |
| Bugs found (of 8 buggy) | 8 (100%) | 0 (0%) | 0 (0%) |
| False alarms (of 6 correct) | 0 | 0 | 0 |
| Fixes verified by re-attack | 8 of 8 | 0 of 0 | 0 of 0 |
| Bugs first found by a model-designed family | 8 | 0 | 0 |
| Runs ending in error / budget / bad oracle | 0 | 0 | 0 |

Load per attack (routed): 2 to 4 (median 3) model calls and 1,179 to 5,381 (median 2,635.5) sandbox runs, which is at least 31 to 385 (median 56.5) Judge0 submissions (up to 64 inputs each, fewer when a long time limit would not fit Judge0's 15 s CPU cap; smaller shrink batches, timeouts and crashes add more).
<!-- bench:fixture:end -->

How to read this honestly:

- In fixture mode the generator families and oracles are **hand-written stand-ins for model answers that we wrote**, knowing the bug classes. These numbers measure the pipeline (oracle check, generation, sandbox runs, shrinking, re-attack), not Nemotron's judgement. Token counts are estimated from text length and model latency is simulated, so time-to-first-counterexample is dominated by simulated latency (Ultra is slower per token, which is why Ultra-only is slower).
- The two ablation columns are the useful ones. **Base tier:** uniform random inputs alone find 27 of 30; they miss the int32 midpoint overflow (only `x = 2^31 - 1`), the `x = 0 / 1` bound in integer sqrt, and crossed brackets like `([)]`. The deterministic families (small-scope, mutations) close that gap on their own: without any model-designed family, 30 of 30 are still found, so none of the base-tier bugs needs the model's families (they are first to break 5 of the 30 in the routed run).
- **Hard tier:** the routed run finds 8 of 8, every time first through a model-designed family (`one-letter-run-no-split`, `all-ones-max-length`, `ambiguous-run-dead-end`, `path-graph-max-n`), with 0 false alarms on the 6 correct solutions and all 8 fixes verified. **Both ablations find 0 of 8** with the same budgets: small-scope inputs are too short to time out or overflow, mutations of short inputs stay short, and 1,000 uniform random inputs never produce a long run of one letter with no split, a run of 78 ambiguous digits or a chain of 100+ heavy edges (a random DAG with 1,000 nodes and 2,000 edges has a longest path of 9 to 15 edges, measured over seeds 1 to 200 with the generator in `src/lib/core/spec.ts` by `bench/longest-path.ts`). Read this with the first bullet in mind: we wrote these families too, knowing the bug classes, and we picked the hard-tier problems for bugs that uniform random search misses. The families are generic for each problem (the textbook worst cases a model is expected to know, not inputs aimed at one file), but the result shows what targeted families can reach, not that Nemotron writes them; the live benchmark measures that. **Not every hard-tier counterexample is minimal:** in the latest fixture run, 2 of the 8 hit the shrink budget and are reported as "not minimal" (both DAG ones, whose shrunk graphs still have hundreds of nodes); the run varies between machines, so 2 to 4 of 8 is typical, and 5 of 8 was seen on a heavily loaded machine.
- Costs are those estimated token counts priced at third-party list prices (Ultra $1 and $3, Super $0.30 and $0.90 per million input and output tokens, `src/lib/models/pricing.ts`), not prices confirmed on an official page, so the routed-to-Ultra ratio rests on those prices too (`BLOCKED.md`: check them in the Token Factory console).
- In fixture mode, each benchmark "fix" is the problem's correct reference solution (`benchFixtures` in `bench/lib.ts`). So "Fixes verified 38 of 38" is a pipeline check, not fix quality.
- Timeout counterexamples depend on the machine: the shrinker keeps the smallest input that still times out, so the length of a minimal timeout input (for plain backtracking, a few dozen letters) varies a little from run to run.

### Soak: hundreds of buggy programs, every claim independently checked

`pnpm soak --all --seeds 3 --readme` builds every single-point mutant of the benchmark solutions (relational, arithmetic, logical and literal mutations, as in mutation testing) and attacks each one in replay mode. It then checks every claimed counterexample against the problem's reference solution (a claimed timeout counts as confirmed when the mutant times out again or still needs at least half its time limit on that input, since the attacking machine may have been busier than the checking run). Every "no counterexample" verdict gets its own 3,000-input differential search, so a missed bug cannot hide. That search draws uniform random inputs, which by construction rarely reach hard-tier bugs, so for hard-tier mutants "survived" is weaker evidence than for the base tier. The table below is an **earlier run (pre-round 9, base tier only: 40 solutions, 3 seeds, written before the hard tier existed), kept for reference**, and no file in `bench/results/` backs it. The latest checked-in run, on all 54 solutions and 1 seed, is in `bench/results/soak-all.md`; rerun the command to refresh this table.

<!-- bench:soak-all:start -->
Soak run: 1071 attacks on 357 mutants (of all 40 benchmark solutions), 3 seed(s), replay mode, local executor, 645 s.

| Outcome | Count | Meaning |
| --- | --- | --- |
| killed | 1017 | counterexample reported **and independently confirmed** against the reference solution |
| unsound | 0 | counterexample reported but not real (must be 0) |
| survived | 54 | no counterexample, and a 3,000-input independent differential search found none either (likely equivalent mutant) |
| missed | 0 | no counterexample, but the independent search found a difference (a real miss) |
| error | 0 | the attack ended in error or budget exhaustion |
<!-- bench:soak-all:end -->

### Live mode (Token Factory + Tavily)

<!-- bench:live:start -->
**Pending a key (see `BLOCKED.md`).** No `NEBIUS_API_KEY` / `TAVILY_API_KEY` was available in the build session (Token Factory's API was reachable from 2026-10-27 and answered 401 without a key; see `docs/FRICTION.md`). Run `pnpm bench --live --readme` to fill this section.
<!-- bench:live:end -->

## Run it

```bash
pnpm install
pnpm test                 # unit (incl. fast-check properties), integration, replay end to end
pnpm dev                  # http://localhost:3000, replay mode without keys
pnpm bench                # fixture-mode benchmark (rewrites bench/results/fixture.md and .json), about 12 minutes on an idle 4-core machine, 15 on a loaded one (Python 3 and Node 22+ needed for the local executor); `--only <problem>` runs one problem
```

Live mode: copy `.env.example` to `.env.local` and set `NEBIUS_API_KEY` (plus `TAVILY_API_KEY` for research). The app, `pnpm preflight` and `pnpm bench` all read `.env.local` (then `.env`); a variable set in the shell wins. Confirm the model ids against Token Factory's model list first.

Sandbox: set `JUDGE0_URL` (and `JUDGE0_TOKEN`, or `JUDGE0_RAPIDAPI_HOST` for RapidAPI) to run code on any Judge0-compatible API. The repo ships its own: **the Counterexample sandbox** (`sandbox/`, one small container) is built to run as a Nebius AI Cloud endpoint (deploy pending, `BLOCKED.md`; the deploy commands have not been run against the live CLI), so the models would run on Token Factory and the attacked code on Nebius AI Cloud. See [docs/NEBIUS-SANDBOX.md](docs/NEBIUS-SANDBOX.md). Run it locally with `pnpm sandbox` (or Docker) and set `JUDGE0_URL=http://localhost:2358`. Without a sandbox, the **local executor** runs Python/JS as subprocesses with time and memory limits. **It is for development only: it is not a security sandbox**, and production refuses it unless `ALLOW_LOCAL_EXECUTOR=1`.

Credentials check: once keys are set, `pnpm preflight` makes one real call to each service. It lists the Token Factory models and checks that both Nemotron ids are offered, sends a one-line prompt to each model, runs one Tavily search, and runs the harness once per language on the sandbox. A missing credential (`NEBIUS_API_KEY`, `TAVILY_API_KEY`) or an absent sandbox (`JUDGE0_URL`, which production requires unless `ALLOW_LOCAL_EXECUTOR=1`) is reported as `skip`, never as a pass; a configured service that fails is `FAIL`, and only `FAIL` makes the command exit non-zero.

Your own code: paste Python 3 or JavaScript that defines the solution as a top-level, synchronous function (`def solve(...)`, `function solve(...)` or `const solve = (...) =>`; another name works in live mode when the statement or the code makes it clear; edited built-ins in replay mode must keep `solve`). Pasting your own problem needs a live key (replay mode covers the built-in problems, whose code you can still edit). Some statements need more than the DSL can say, and a correct solution can then be blamed: when several answers are valid (any pair that sums to the target), when rows must all have the same length (a grid) or two arrays must be as long as each other (`gas` and `cost`), when one parameter is the length of another (`n` and `a`), when the function changes its argument in place and returns nothing (only return values are compared), when it takes tree or linked-list nodes (inputs are JSON values: a `TreeNode` solution receives a list), or when a graph must be a tree, connected or simple (generated graphs can be disconnected and have parallel edges and, unless they are DAGs, self-loops). Return values must be JSON values too: a Python `set` or `deque` is reported as a runtime error, and a JavaScript `Set` or `Map` arrives as `{}`; return a list or an object. The harness adds no imports, so LeetCode code needs its own (`from typing import List`). For those, ask for one canonical answer in the statement ("the pair with the smallest indices"), pass the grid or array alone and derive `n` from it, and return the changed array. A LeetCode-style method inside `class Solution` is not supported yet (a live attack stops and says so; in replay mode the run reports that `solve` is missing), so move it to the top level; an `async` JavaScript function is reported as a runtime error.

Deployment: a Vercel preview is intended to work for the UI (not deployed yet; see `BLOCKED.md`); set the env vars above. A public deployment also needs a sandbox endpoint (`JUDGE0_URL`), because production refuses the local executor.

Browser smoke test: `pnpm build`, then `pnpm e2e`. It starts `next start` itself in replay mode and drives the page in the Chromium that Playwright has installed (`pnpm exec playwright install chromium` if it is missing). It refuses to run when there is no build, or when a file under `src/` is newer than the build, so it never tests a stale UI.

## Load and limits

- **Per attack:** at most 8 model calls and 50 s of wall clock on the public endpoint (12 calls and 120 s in the library), and 60,000 sandbox runs. That works out to about 300 inputs per family, 2,000 shrink evaluations, 3 oracle attempts and 2 fix attempts. What the 54 benchmark solutions actually use is in the "Load per attack" line of the benchmark results above, written by `pnpm bench --readme`. A pasted statement adds one model call (understanding it), inside the same cap. Generated values are capped by the DSL (lengths up to 10,000; graphs up to 1,000 nodes and 10,000 edges; a pasted statement up to 8,000 characters and code up to 20,000; at most 200,000 values per input; a value may match at most 16 `oneOf` alternatives in all, nested or not, and checking one input may take at most 200,000 steps). Process output is capped at 8 MB (local executor and sandbox), any single result over 256,000 characters, and one process's (or Judge0 submission's) results past 1,000,000 characters in total, are refused unread, as are records beyond the number of inputs it was given, since parsing and comparing results costs server CPU (results left unread only for that total are judged again in fresh runs, charged to the run budget, and later runs are cut to as many inputs as fitted, so very verbose outputs take many more sandbox processes per input); a process pool sized to the CPU count bounds concurrent processes. Server-side work yields to the event loop between families, chunks, judged results and slices of shrinking and deduplication; at these caps the largest single step (parsing one process's 1,000,000 characters of results, or generating one family's 500,000 values) takes a few hundred milliseconds.
- **Per model call:** a call that sets no limit asks Token Factory for at most 16,384 completion tokens from the reasoning model and 8,192 from the fast one (`src/lib/models/config.ts`), because hidden reasoning counts against the same limit. A call that ends at the limit with no text fails with a typed error (`ModelOutputError`, finish reason `length`) instead of passing an empty answer on. Not yet run against Token Factory.
- **Per server instance:** `MAX_CONCURRENT_ATTACKS` (default 2: an attack whose model-written families sit at the DSL caps can hold about 1 GB of generated inputs until it ends, so plan about 1 GB of memory per concurrent attack on top of the server's own; two attacks at the caps peaked at 1.9 GB for the whole process, so give a 2-attack instance at least 2.5 GB), per IP `RATE_LIMIT_PER_HOUR` (default 10) and `ATTACKS_PER_IP_PER_DAY` (default 30) for live attacks and `REPLAY_RATE_LIMIT_PER_HOUR` (default 120) for replay attacks, which cost no model money, and `DAILY_SPEND_CAP_USD` (default $2) across all live attacks. With the defaults, each live attack reserves its worst case at admit: 8 calls (the public cap) at 32,000 prompt and 16,384 completion tokens on Ultra ($1 and $3 per million tokens) is about $0.65, so the cap alone would allow at most 3 live attacks in flight ($1.95 reserved; a 4th would exceed the $2 cap and is refused), and the concurrency default allows 2. The reservation is settled to the real cost when an attack ends. The IP table is capped at 10,000 entries. Client IPs come from forwarding headers only on Vercel (`VERCEL=1`: `x-real-ip`, which the platform sets) or behind a proxy that appends to `X-Forwarded-For` (`TRUST_PROXY_HEADERS=1`: the right-most entry only, since the client controls the rest); anywhere else those headers could be spoofed, so all clients share one bucket. The daily spend cap reserves a worst-case cost for each attack when it is admitted and settles the real cost when it ends, so concurrent attacks cannot overshoot it. Request bodies over 88 KB are refused before they are read in full. If the client disconnects, the attack stops at its next model call or sandbox run.
- **Expected load and where it breaks first:** a hackathon demo, with tens of concurrent users at most. With the defaults, the first limit hit is the concurrency cap: a live attack runs up to 50 s and at most 2 run at once, so a third simultaneous attack gets a fast 503 (raise `MAX_CONCURRENT_ATTACKS` with about 1 GB of memory per attack). Past that cap, the next limit is the sandbox. Each attack sends several Judge0 submissions (the measured count is in "Load per attack" above), so a shared Judge0 instance saturates first. Judge0 limits CPU time per submission, not per input (a submission of n inputs gets n times the per-input limit, and never more inputs than fit in its 15 s cap), so a slow input is caught as a timeout of its submission, confirmed by running it alone, and the rest are resubmitted; once a submission comes back clean, the next few go out together, so a window is not several serial round trips (this stops at the first hang or crash); the attack-concurrency cap bounds how many attacks drive the sandbox at once (an attack aborted mid-run leaves its already-sent submissions to finish at their time limit, so a client that rapidly connects and aborts can still briefly fill the sandbox queue, bounded by the per-IP rate limits). Next come the guards: they live in memory, so with N serverless instances the effective limits are N times higher. A shared store (Redis or Vercel KV) is the fix, and it is the one change needed before a real launch. Token Factory cost is capped per day; Token Factory latency (not measured yet; see `BLOCKED.md`) sets the wall-clock floor.

## Layout

```
src/lib/core      input DSL, seeded RNG, comparison, shrinker
src/lib/exec      Executor interface, harness, Judge0Executor, LocalExecutor
src/lib/models    Token Factory client, replay + recording providers, routing, pricing
src/lib/agent     run.ts (orchestrator), stages, families, judge, model calls, prompts, parsers, budgets, trace, guards
src/lib/net       postJson: timeouts, retries with backoff, idempotency key
src/lib/research  Tavily client and research trigger
src/fixtures      hand-written replay fixtures for the 13 problems
tests/unit        pure functions, fast-check property tests (seeded; FC_SEED=n to explore)
tests/integration executors, providers (mocked HTTP), API route, failure paths, fixtures vs sandbox
tests/e2e         the whole loop in replay mode
src/app           Next.js UI and /api/attack (NDJSON stream)
bench/            solutions, benchmark script, results
docs/             SUBMISSION (Devpost fields), NEBIUS-SANDBOX, FEEDBACK, FRICTION, VIDEO shot list, architecture.svg, screenshots/
sandbox/          the Counterexample sandbox (Judge0-compatible, for a Nebius Serverless AI endpoint)
```

`.agent/` and `WIN-CHECKLIST.md` hold the build process's audit trail and evidence; they are not part of the app.

Built by the AlgoCracked team. Interview prep is the first use; attacking AI-written code before you merge it is the everyday one.
