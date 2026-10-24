# WIN checklist: Counterexample (Nebius x NVIDIA Global AI Hackathon)

Freeze: **Thu 2026-10-29 18:00 EAT (15:00 UTC)**. Read by `bash .agent/win-gate.sh COUNTEREXAMPLE`.

Legend:
- `- [x]` done, with evidence in this repo.
- `- [P]` built and tested; the final proof needs an owner input listed in `BLOCKED.md`.
- `- [-]` not applicable.

## Judging criteria

- [x] **Built well:** typed, budgeted, cancellable stages (`src/lib/agent/`). Every external input is schema-validated, errors are typed, and network calls have timeouts, retries with backoff and an idempotency key. Evidence: 230+ tests (`pnpm test`), lint with 0 warnings, strict TypeScript, `next build` passes.
- [x] **Uses Token Factory and Nemotron by design:** Ultra writes the oracle and the explanation, Super writes the generators and research summaries. There is an Ultra-only baseline and a per-step cost and latency panel. Evidence: `src/lib/agent/model-call.ts`, `tests/e2e/agent-replay.test.ts` (routing assertions), `bench/results/fixture.md`.
- [P] **Live Token Factory run:** proven over real HTTP against fake Token Factory and Tavily servers plus the real sandbox (`tests/integration/live-wiring.test.ts`: full attack, a 429 retried, a custom statement through the API). `pnpm preflight` is ready. Needs `NEBIUS_API_KEY` and network access (BLOCKED.md).
- [x] **Creativity:**
  - an oracle that must pass the examples before any bug is claimed (after ALGO);
  - model-written generators as a bounded, interpreted DSL;
  - small-scope bounded-exhaustive inputs;
  - EvalPlus-style mutation;
  - delta debugging over structured inputs;
  - fixes re-attacked before they are called fixed;
  - research into the documentation of risky APIs the code calls.

  Evidence: `src/lib/core/`, `src/lib/research/plan.ts`, README "Design choices".
- [x] **Design (UX):**
  - one click to a minimal counterexample in replay mode;
  - live trace;
  - the fix as a diff against the submitted code;
  - "Why Ultra here, Super there" panel;
  - share link;
  - "Try it in 60 seconds" in the README;
  - accessible chips (`aria-pressed`) and a verdict announced to screen readers.

  Evidence: `docs/screenshots/` (390 px; no horizontal overflow, no page errors).
- [x] **Potential impact:**
  - Benchmark: 30/30 bugs found, 0/10 false alarms, fixes verified (`bench/results/fixture.md`).
  - Soak: every claimed counterexample independently confirmed, 0 unsound and 0 missed across 1,071 attacks on 357 mutants (`bench/results/soak-all.md`).
- [x] **Best use of Tavily (bonus):** research covers the problem's sources and the documentation of risky APIs. One search and one cited summary per question; families may cite only this run's facts; the report shows which families research shaped. Evidence: `tests/unit/plan.test.ts`, e2e test "on request, researches the documentation of risky APIs…", replay fixtures checked against MDN and the Python docs.
- [P] **Live Tavily run:** `TavilyClient` is proven over real HTTP (fake server) and by `pnpm preflight`. Needs `TAVILY_API_KEY` (BLOCKED.md).

## Brief requirements

- [x] 1. Scaffold: Next.js with TypeScript and pnpm, MIT `LICENSE`, `README.md`.
- [x] 2. Token Factory client (env base URL, key, model ids) plus a deterministic replay provider. Evidence: `src/lib/models/`, `tests/integration/providers.test.ts`.
- [x] 3. `Judge0Executor`. Evidence: `src/lib/exec/judge0.ts`, `tests/integration/executors.test.ts`, `tests/integration/sandbox.test.ts`.
- [x] 3. `LocalExecutor`: Python and JS, time and memory limits, dev only, labelled; production refuses it. Evidence: `src/lib/exec/local.ts`, tests.
- [x] 3 P1. Nebius AI Cloud executor: our own Judge0-compatible sandbox (`sandbox/`) deployable as a Nebius Serverless AI endpoint (`docs/NEBIUS-SANDBOX.md`). Docker build, preflight and benchmark verified locally.
- [P] 3 P1. Sandbox deployed on Nebius AI Cloud. Needs AI Cloud credentials and a registry (BLOCKED.md).
- [x] 4. Agent loop as explicit typed stages with budgets and a streamed structured trace. Evidence: `src/lib/agent/stages.ts`, `budget.ts`, `trace.ts`, `tests/unit/budget-trace.test.ts`, `tests/integration/api.test.ts`.
- [x] 5. Generic shrinker over arrays, strings and graphs, unit- and property-tested. Evidence: `src/lib/core/shrink.ts`, `tests/unit/shrink.test.ts`.
- [x] 6. Research stage only when the statement references external facts or the user asks, cited, showing its effect on the generators. Evidence: `researchPlan`, trace "Research shaped …", tests.
- [x] 7. UI: paste, or pick one of 5 classic buggy problems; live trace, counterexample, fix, re-attack; phone width. Evidence: `src/app/`, `docs/screenshots/`.
- [x] 8. Benchmark: 30 buggy and 10 correct solutions; bug-found rate, time to first counterexample, false alarms, cost Ultra-only vs routed; every README number from the script. Evidence: `bench/run.ts`, `bench/results/fixture.md`.
- [P] 8. Live benchmark numbers (`pnpm bench --live --readme`). Needs the Nebius key (BLOCKED.md).
- [x] 9. Rate limit by IP and daily model-spend cap. Evidence: `src/lib/agent/guard.ts`, `tests/unit/guard-limit.test.ts`.
- [P] 9. Vercel deployment with env vars. Needs the owner's Vercel project and keys (BLOCKED.md).
- [x] 10. `docs/FEEDBACK.md`, `docs/FRICTION.md`, `docs/VIDEO.md`, `SUBMISSION.md`, `docs/architecture.svg`.
- [P] 10. Demo video filmed and published. Needs the owner's footage and YouTube (BLOCKED.md).
- [P] Public repo before submission. Owner action (BLOCKED.md).
- [x] Done-when: replay end to end in tests (`tests/e2e/agent-replay.test.ts`); live marked owner-to-verify.

## Quality bar

- [x] Lint with 0 warnings, strict TypeScript (`noUncheckedIndexedAccess`), all tests green, `next build` green. Evidence: `.agent/win/COUNTEREXAMPLE/checks.sh`.
- [x] Property tests with fast-check and a fixed seed; deep runs at `FC_NUM_RUNS=5000` passed. Evidence: `.agent/win/COUNTEREXAMPLE/break-it.md`.
- [x] Integration tests at every boundary: executors, providers, sandbox, API route, live wiring over real HTTP.
- [x] Failure paths: timeouts, aborts, 429/503 retries, 401, malformed JSON, schema violations, budget exhaustion, partial results, a full sandbox queue.
- [x] Soak and failure injection: the mutation soak (`pnpm soak`), fake 429s, hanging providers, a missing runtime.
- [x] Fresh-clone README run passed (break-it.md).
- [x] Security: sandbox env isolation tested; constant-time token auth; share links schema-validated (http(s) links only); no SSRF (URLs from env only).
- [x] Scalability statement with measured load (README "Load and limits").

## Audit findings (all fixed; details in `.agent/win/COUNTEREXAMPLE/reaudit.md`)

- [x] Round 2: 10 code-review findings fixed in `f19cb63` (per-family validation, spend-cap bypass, slot leaks, and more).
- [x] Round 3: 10 code-review findings fixed in `0993b4e` (share-link validation, `hashchange`, citation filter, and more).
- [x] Round 4a: queue-full bug in the sandbox (503 while a slot was free) fixed; regression test in `sandbox.test.ts`.
- [x] Round 4a: shell profile variables leaking into user code fixed (`--noprofile --norc`); tested.
- [x] Round 4a: `x = 5`-style bugs missed by random sampling; fixed by the small-scope family; regression test in `api.test.ts`.
- [x] Round 4a: edited demo code replayed the demo's explanation; fixed with an honest replay explanation; tested.
- [x] Round 4b: 10 code-review findings fixed:
  - brief-compliant research trigger;
  - `|| 0` false positive;
  - wrong-language replay fix;
  - per-question research errors;
  - reasons within the cap;
  - small-scope graph bound;
  - per-family budget caps;
  - soak writes the README only when clean;
  - memoised diff;
  - CRLF diff.
