# Counterexample: Devpost submission (paste-ready)

Each section below is one field of the Devpost project form, in the order the form asks for them. Copy the text inside each block as it is. Fields marked **Owner** need something only the owner has (a link or an account); everything else is final.

Facts checked against the repo at the commit that last changed this file. The numbers come from `bench/results/fixture.md` (`pnpm bench --readme`, replay mode).

## Before you submit (owner)

- [ ] The repo `mlsniperpro/counterexample` is public (MIT `LICENSE` at the top).
- [ ] The demo video is on YouTube, public, and at most 3 minutes (script: `docs/VIDEO.md`).
- [ ] The Vercel preview URL works (or leave "Try it out" as the repo only).
- [ ] The live benchmark is pasted in, if a key was available (`pnpm bench --live --readme`); otherwise keep the "replay mode" wording below as it is.
- [ ] The feedback form is filled from `docs/FEEDBACK.md`.
- [ ] Check the Devpost form for hackathon-specific questions not listed here. The build session could not open devpost.com (HTTP 403), so the custom questions below are written from the rules in `BRIEF.md`.

## Project name

```
Counterexample
```

## Elevator pitch (200 characters max)

```
A coding agent that breaks your code before your interviewer does: Nemotron writes an oracle and adversarial input generators, then you get a minimal counterexample and a re-attacked fix.
```

## Thumbnail and image gallery (Owner: upload)

- Thumbnail: `docs/screenshots/390-2-report.png` (the report with the minimal counterexample).
- Gallery, in order: `docs/architecture.svg` (export to PNG), `docs/screenshots/390-1-form.png`, `docs/screenshots/390-2-report.png`, `docs/screenshots/390-3-shared-link.png`.

## Video demo link (Owner)

```
https://www.youtube.com/watch?v=OWNER_TO_ADD
```

## Try it out links

```
https://github.com/mlsniperpro/counterexample
```

Owner: add the Vercel preview URL as a second link once it is deployed (`BLOCKED.md`).

## Built with

```
typescript, next.js, react, node.js, python, nebius-token-factory, nvidia-nemotron, nebius-ai-cloud, tavily, judge0, docker, seccomp, zod, vitest, fast-check, playwright
```

## Track and prizes

- **Track:** Coding and Agentic Engineering.
- **Bonus prize:** Best Use of Tavily.

## About the project

Paste everything between the two rules into the "About the project" field (Devpost renders Markdown).

---

## Inspiration

"All tests pass" is where most coding help stops, and it is exactly where interviewers and code reviewers start. A strong interviewer does not rerun your examples. They look for the one input you did not think of: the empty array, the value at 2^31 − 1, the coin system where greedy fails, the graph with a negative edge. We build interview-prep tools (AlgoCracked), and we wanted an agent that does that part of the job: it does not write the code, it **breaks** it, and it proves the break with a minimal input. The same need shows up every day with AI-written code: it looks right, passes the obvious cases, and fails on the input nobody tried.

## What it does

Paste a problem and a solution (your interview answer, or code an AI wrote) and press **Attack**.

1. **Understand.** The problem becomes a typed spec of its parameters and constraints. When the statement relies on outside facts, or the code calls an API with a well-known trap (JavaScript's `sort()` without a comparator, Python's banker's `round()`), **Tavily** fetches the official sources and every fact is cited in the trace.
2. **Build an oracle.** **Nemotron 3 Ultra** writes a slow but obviously-correct brute force. It must reproduce the statement's examples before it is trusted; otherwise the verdict is "oracle unreliable" and no bug is claimed.
3. **Attack.** **Nemotron 3 Super** designs adversarial input *generators* (not test cases) in a typed JSON DSL: bounds, duplicates, overflow, worst-case sizes, deep chains. They run alongside deterministic families: bounded-exhaustive small inputs and EvalPlus-style mutants.
4. **Run.** The solution and the oracle run on thousands of inputs in a sandbox (any Judge0-compatible API, or our own hardened sandbox).
5. **Confirm and shrink.** A mismatch counts only once it reproduces alone on a fresh run. Delta debugging then shrinks it to a minimal counterexample, for example `solve([2, 5], 6)`: expected 3, got -1.
6. **Explain and fix.** Ultra explains the bug in two sentences and proposes a fix. The whole attack is **re-run on the fix** before it is called fixed.
7. **Report.** A live trace shows every model call (which model, why, tokens, cost, latency) and every run. A "Why Ultra here, Super there" panel shows the cost of each step, and a share link carries the report in the URL.

## How we built it

- **Nebius Token Factory and NVIDIA Nemotron.** Every model call goes through Token Factory's OpenAI-compatible API. We route by the cost of being wrong:
  - **Nemotron 3 Ultra** handles the oracle and the root cause, where a mistake means a false alarm or a wrong fix.
  - **Nemotron 3 Super** handles generator design and research summaries, which are cheap to try and checked by a validator.
  - The benchmark compares this routing against Ultra everywhere.
- **Nebius AI Cloud.** The attacked code runs in our own Judge0-compatible sandbox (`sandbox/`). It is built to deploy as a Nebius Serverless AI endpoint, so the models run on Token Factory and the code they attack runs on Nebius AI Cloud. Each run is isolated:
  - its own unprivileged uid;
  - a seccomp filter that denies network sockets and IPC;
  - resource limits;
  - a kill-all afterwards.
- **Tavily** searches the problem's sources and the documentation of risky APIs the code calls. A fact such as MDN's "numbers are converted to strings, '80' comes before '9'" becomes a generator family that breaks a merge sorted with plain `sort()`.
- **Safety by construction.**
  - Model-written generators are interpreted, never executed, and every value they produce is bounded and checked against the problem's constraints.
  - Every external input (API body, model answers, Token Factory, Tavily and Judge0 responses) is schema-validated with zod.
  - Network calls have timeouts, bounded retries with backoff and idempotency keys.
  - Each attack has budgets for model calls, sandbox runs and wall clock.
  - Per-IP rate limits and a daily spend cap protect the public demo.
- **Next.js and TypeScript** (strict) for the UI and the streaming API, a deterministic **replay provider** so the whole agent runs in tests and for judges without keys, and 490+ tests:
  - unit tests;
  - fast-check property tests;
  - integration tests;
  - a replay end-to-end test;
  - a Playwright browser smoke test.

## Challenges we ran into

- **False alarms are worse than misses.** A correct binary search looked broken under a loaded sandbox. We now confirm every mismatch alone in a fresh process before claiming it. A failure that only appears after earlier calls is reported as "order-dependent" (the solution keeps state), never as flaky.
- **Judge0 has one time limit per submission.** We size batches so every input keeps its full limit inside the 15 s CPU cap, and blame a timeout on an input only after it times out alone.
- **Exact answers.** Integers past 2^53 lose digits in JavaScript, so an overflow in the last digit would go unnoticed. We compare them by their exact digits.
- **Hostile inputs.** Pasted code and model-written specs can try to freeze a server. Every generator, shrinker and parser step is bounded, and ten rounds of hostile audits found and fixed more than 150 issues.
- **No keys in the build environment.** The Token Factory API and docs were unreachable from our build sandbox, so we built a replay provider and recorded every friction point in `docs/FRICTION.md`.

## Accomplishments that we're proud of

- **38 of 38 known bugs found, 0 false alarms on 16 correct solutions**, across 13 problems in Python and JavaScript, with every fix verified by re-attack (replay mode: hand-written stand-ins for the model answers, real execution).
- **Where the models matter, measured honestly.** On 8 "hard tier" bugs that only show at worst-case sizes or on specific structure (exponential backtracking, overflow on a long chain), the model-designed families find 8 of 8. Both ablations find 0 of 8: one without model families, and one with examples plus 1,000 random inputs. We wrote those stand-in families knowing the bug classes, and say so; the live run measures whether Super writes them itself.
- **Routing pays.** Routed Ultra + Super costs about half as much as Ultra everywhere ($0.0882 against $0.1725 for all 54 solutions, estimated from replayed token counts) and reaches the first counterexample faster (median 5.4 s against 11.2 s), with the same results.
- Counterexamples a person can read: `solve([0], 0)`, `solve(2147483647)`, `solve("baab")`.

## What we learned

- Generators beat test cases. A model is much better at describing *what kind* of input breaks code than at writing the one input that does, and a typed DSL makes that description safe to run.
- Small inputs find most bugs (the small-scope hypothesis). On the base tier, the deterministic families (exhaustive small inputs, mutations and random inputs) found all 30 bugs without the models, so the models earn their cost on the hard ones.
- An honest verdict needs a trustworthy oracle. Making the oracle pass the examples first, and saying "evidence, not proof" when nothing breaks, matters more than any clever generator.

## What's next

- Deploy the sandbox as a Nebius Serverless AI endpoint and publish the live benchmark.
- A GitHub app that attacks AI-written functions in a pull request before merge.
- More problem families: floating point, interactive problems and data-structure APIs.

---

## Hackathon questions

**Which Nebius products does the project use?**

```
Nebius Token Factory for every model call (OpenAI-compatible API). Nebius AI Cloud for code execution: our Judge0-compatible sandbox is built to run as a Nebius Serverless AI endpoint (docs/NEBIUS-SANDBOX.md).
```

**Which NVIDIA open models, and how?**

```
NVIDIA Nemotron 3 Ultra (nvidia/Nemotron-3-Ultra-550b-a55b) writes the brute-force oracle and explains and fixes the bug, where correctness matters most. NVIDIA Nemotron 3 Super (nvidia/nemotron-3-super-120b-a12b) designs the adversarial input generators and summarises research, where speed matters. The report shows which model ran each step, with tokens, cost and latency.
```

**How does the project use Tavily? (Best Use of Tavily)**

```
Tavily runs a research stage when the problem statement relies on external facts or the code calls an API with a documented trap. It searches the problem's official sources (constraints) and the documentation of risky APIs, such as JavaScript's sort() without a comparator or Python's round(). Every fact keeps its URL, a generator family may cite only facts from this run's research, and the report shows which attack families the research shaped. Example: MDN's note that sort() compares numbers as strings becomes a family of two-digit intervals that breaks a merge-intervals solution.
```

**Feedback on Token Factory, AI Cloud and NVIDIA tools (required).** Paste from `docs/FEEDBACK.md`, section by section.

**Team:** AlgoCracked. Owner: add the team members' Devpost accounts.
