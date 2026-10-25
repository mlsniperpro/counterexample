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
  - Benchmark: 38/38 bugs found, 0/16 false alarms, fixes verified; the 8 hard-tier bugs are found only through model-designed families (both ablations find 0 of 8) (`bench/results/fixture.md`).
  - Soak: every claimed counterexample independently confirmed, 0 unsound and 0 missed across 503 attacks on 503 mutants of all 54 solutions, 1 seed (`bench/results/soak-all.md`; the README table is the earlier 3-seed run on the 40 base-tier solutions: 1,071 attacks, 0 unsound, 0 missed).
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
- [x] 8. Benchmark: 38 buggy and 16 correct solutions (base tier 30 + 10, hard tier 8 + 6); bug-found rate, time to first counterexample, false alarms, cost Ultra-only vs routed; every README number from the script. Evidence: `bench/run.ts`, `bench/results/fixture.md`.
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
- [x] Security: sandbox env isolation tested; per-run uid, process cap and kill-all-after-run in the container (Docker-tested, `break-it.md`); constant-time token auth; share links schema-validated (http(s) links only); no SSRF (URLs from env only).
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
- [x] Round 5 (full hostile audit of `ee9018d`): 3 critical, 4 high, 7 medium/low findings, all fixed with regression tests that fail on the old code:
  - critical: a forked child escaped the time limit and held a sandbox slot forever; runs now get their own process group, and in the container their own uid whose every process is killed after the run (`tini` reaps them);
  - critical: user code could read the sandbox token from the server's environment and outlive its run; each run slot now has its own unprivileged uid with a private directory and a 64-process cap, and the server drops the token from its environment;
  - critical: checklist cited `break-it.md` before it existed; it is now written per tested commit;
  - high: a Python `inf`/`nan` result shifted every later result onto the wrong input; non-finite floats are now encoded the same way in both languages, and an unreadable line keeps its place;
  - high: model-written generators could exhaust memory; a family is cut to 500,000 values and generation checks the deadline;
  - high: the understand call for a pasted statement was untraced, unbudgeted and had no deadline; it is now an attack stage like the others;
  - high: responses without token usage, and failed or cut-off calls, cost $0 against the spend cap; they now count as unpriced;
  - medium: "no mismatch on N inputs" counted inputs the oracle could not judge; it now counts judged inputs only and says how many were not;
  - medium: FEEDBACK.md said the Nebius P1 was not attempted; updated to the built sandbox endpoint;
  - medium: hand-typed load numbers; `pnpm bench --readme` now writes the "Load per attack" line;
  - medium: spoofable `x-forwarded-for`; forwarding headers are trusted only on Vercel or with `TRUST_PROXY_HEADERS=1`;
  - low: shared links now say they were not verified by the server; Judge0's per-submission CPU limit is documented; a Python `__main__` block or JS `export` no longer breaks loading.
- [x] Round 6 (four parallel hostile audits of `04f1f92`: agent core, security, judge view and docs truth, UI/tests/scalability; plus a sandbox benchmark run that hit a false alarm). Every finding below was reproduced, then fixed with a regression test:
  - high: a spurious timeout (Judge0's CPU budget is shared across a whole submission, so a loaded machine can cut it) was blamed on an innocent input, and the shrink stage claimed a bug its own re-check did not reproduce; a correct binary search was reported as broken. Fixed at three levels: Judge0 submissions now hold only as many inputs as fit their full limits in the 15 s cap; a timeout in a shared-budget chunk is blamed on an input only after it also times out alone; and every mismatch must reproduce on a fresh re-run before it counts, otherwise it is dropped with a trace warning and the attack goes on (`tests/integration/confirm-shrink.test.ts`, `tests/unit/program.test.ts`);
  - high: correct code returning an object with keys in another order was flagged; comparison now sorts keys recursively (`tests/unit/compare.test.ts`);
  - high: a solution's output was never size-limited (a 4 MB string reached the stream, the DOM and a ~1M-token explain prompt); outputs are clipped to 2,000 characters for display, trace, report and prompts, while comparison uses the full value;
  - high: submitted code had outbound network access from the sandbox (security fix, see below);
  - medium: integer answers beyond 2^53 were rounded before comparison, hiding last-digit overflow bugs; the harness parser now keeps them exact;
  - medium: a mismatch already found was lost if a budget or cancellation hit during shrinking; the confirmed hit is now recorded before shrinking;
  - medium: an oracle answer without a code block ended the attack instead of using the remaining attempts; it now retries with feedback;
  - medium: the shrinker missed adjacent pairs at unaligned offsets (`({())}` instead of `({)}`); pairs and singles are now removed at every offset (`tests/unit/shrink.test.ts`);
  - medium: switching problem mid-run showed the old run's results; a cut stream showed no error; there was no cancel or client timeout (`src/app/stream.ts`, `tests/unit/stream.test.ts`, Playwright-verified);
  - medium: `/api/attack` read bodies of any size before validation; one user could fill the sandbox's /tmp and /dev/shm; memory was limited per process, not per run; `pnpm sandbox` listened on all interfaces with no token; two sandbox instances on one host killed each other's runs; no test covered slot release or spend charging (security fixes, see below);
  - low: "minimal counterexample" was claimed when the shrink budget ran out; the report now says it may not be minimal;
  - low: deeply nested share links threw RangeError; the decoder caps nesting at 64 and always throws `ShareLinkError`;
  - low: a long shared title overflowed at 390 px; errors and verdicts were not announced; table regions were not keyboard-focusable; warning text was below WCAG AA (now 5.38:1 light and 7.70:1 dark); statement backticks showed raw (axe-core: 0 violations);
  - low: `X-Forwarded-For` was read left-most and `x-real-ip` trusted off Vercel; the daily spend cap was checked only at admit (security fixes, see below);
  - docs: architecture.svg still showed the P1 as "planned" and lacked the sandbox, small-scope, mutation and API-doc research; FEEDBACK.md lacked onboarding and "use it again" for Nemotron, AI Cloud and Tavily; SUBMISSION.md left out the Tavily API-doc research and AI Cloud, and still listed a Jobs executor; the README lacked the Dijkstra line, contradicted itself on share links and claimed exact timing; FRICTION.md had a stale load estimate; NEBIUS-SANDBOX.md cited a benchmark run on an older image.
- [x] Round 7 (four parallel full audits of `91aa3f5`; the security audit found nothing exploitable). Fixed with regression tests:
  - high: the "no model generators" ablation also dropped the small-scope family, overstating Nemotron's role; the benchmark now has a separate no-model ablation, a "Found by family" column and a model-found row, and the README states that the deterministic families alone find 30/30;
  - medium: an example output beyond 2^53 made a correct oracle "unreliable"; a correct JS solution returning a BigInt was flagged; the JS harness used `performance`, which Judge0 CE's default Node 12 lacks (now perf_hooks, checked under a real Node v12.14.0); Judge0 never enforced the per-input time limit inside a finished submission (now checked, after a solo re-run); a fix was "verified" when the oracle could judge none of the re-attack (the counterexample itself must now be judged, and unjudged inputs are reported); the confirm step could drop a real bug behind four flaky ones (it now re-checks in batches until one reproduces);
  - medium: architecture.svg claimed no model output runs; replay demos hit 429 after 10 attacks (replay now has its own limit of 120 per hour); VIDEO.md described a demo the app no longer shows (it now uses coin-change, with numbers from the replay run);
  - low: the run reserve was twice what shrinking needs; the big-integer marker leaked into JSON output (exact digits are now written at every JSON boundary); a dead shrink candidate; float mode compared object values exactly; the timing label said "wall clock" in fixture mode.
- [x] Round 8, agent core and executors (audit of `0e938c2`; every finding verified before fixing, each fix with a regression test that fails on the old code):
  - high: an unreadable generator answer ended the attack before the deterministic families ran; the attack now goes on with them and says so, and `extractJson` reads the first balanced object;
  - high: running out of time during the re-attack lost the proposed fix; the fix is now recorded before the re-attack, the re-attack runs in chunks with the counterexample first, and a failing fix stops after its first failing chunk;
  - medium: on Judge0, the chunk size halves after a timeout or crash in a shared chunk (a simulated run with many hangs dropped from 831 s to 86 s); a crash is blamed only after a solo re-run;
  - medium: big-integer values in prompts, oracle feedback and the trace JSONL show exact digits; JS numbers above 2^53 are written by their exact value, so `2**60` equals Python's `1 << 60`;
  - medium: an entry name the code does not define falls back to the code's own function (`solve` first), and JS `export`/`async` functions are recognised;
  - medium: a cancel during research ends the attack there;
  - low: the no-bug message counts mismatches that did not reproduce; accurate wording when a shrunk input does not fail again; dead code and file-local exports removed.
