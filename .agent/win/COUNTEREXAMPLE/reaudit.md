AUDITED_COMMIT: d5e09fa
OPEN_CRITICAL: 0
OPEN_HIGH: 0
CLEAN_AUDITS_IN_A_ROW: 1  # round 44 (code d8840e8) fully clean; rounds 35-43 each had a medium (all fixed)

# Re-audit log (Counterexample)

Each audit is a full pass over the whole entry, as a strict judge and a hostile senior reviewer: correctness, security, robustness, performance, UX, docs-vs-code truth, and brief compliance. Tools: a manual read plus the `code-review` skill at high effort.

## Round 44 (2026-10-30, `d8840e8`, 4 parallel Sonnet/high audits, ~25-minute time box each; all four reported) — CLEAN

**Fully clean: no finding at medium or above in any dimension.** First clean round; code unchanged since (only `.md` files).
- **Core** CLEAN: all of src/lib core re-read (stages, judge, run, budget, program incl. the prefetch, judge0, compare, shrink, spec, smallscope, families, mutate, parse, understand, research plan, model-call, http, api, route); a Python-vs-JS harness differential at 2^53-1, 2^31, negatives and 14-digit values introduced no false difference. Lows (accepted): an astral-character alphabet from a live model could make JS `s.length` differ from Python; Python recursion between the default limit and the harness's 100000 can segfault; the fix re-attack does not re-confirm its own mismatches (costs at most one extra fix attempt, never a false "verified"); a budget-cut `Promise.all` leaves the other side in flight (the accepted aborted-submissions note).
- **Security** CLEAN: `pnpm audit --prod` no known vulnerabilities; sandbox unchanged since round 35 and `sandbox.test.ts` 22/22 as root; no secrets tracked; route, guards, Judge0 client, SSRF, share links, client rendering and a ReDoS re-read all held. Below bar: a hostile statement of rare characters could tokenize past the 32k-prompt reservation (the daily cap can be overshot once by under ~$1, then admits stop); the documented shared bucket without trusted proxy headers; share links are unsigned by design.
- **UI and tests** CLEAN at the medium bar (~60 one-line mutants traced): every report, Markdown, trace, diff and share field pinned; AttackUI wiring covered by the e2e. Low (wording class): the language dropdown's visible option text is not asserted.
- **Judge/docs** CLEAN: every figure, constant, command, path and replayed demo reconciled. Low fixed: HANDOFF's newest STATE entry now covers rounds 43 and 44.

## Round 43 (2026-10-30, `bae0b9f`, 4 parallel Sonnet/high audits, ~25-minute time box each; all four reported)

Not clean by a hair: core, security and judge/docs CLEAN; UI found 1 medium and 1 borderline medium test gap (no shipped wrong-data or a11y bug), fixed in the next push.
- **Core** CLEAN: the round-42 prefetch fuzzed against a strictly sequential copy (400 random cases mixing ok/slow/hang/crash/flaky/reject/compile inputs: 0 differences in outcomes, errors or the compile fill; `processes` always equals runChunk calls; no unhandled rejection; at most 3 in flight), and matched sequential exactly against the real sandbox. Lows: on a slot-starved sandbox the up-to-2 discarded prefetches still hold run slots (wall clock only; the docs now say "at most 2 wasted submissions" instead of "exactly what they did sequentially"); one attack can queue up to 6 submissions (bounded by the sandbox queue's 503 + retry); a rejected prefetch can be reused at chunk size 1 (already retried 3 times).
- **Security** CLEAN: the prefetch adds load but every bound holds (3 in flight per run, about 6 per attack, the sandbox's slots and 503 queue, the deadline abort reaching every in-flight fetch, no unhandled rejection).
- **UI and tests** (125 applied mutants): `lineDiff` had no whitespace-only test, so a `.trim()` comparison mutant showed an indentation-only fix (the classic return dedented out of a loop) as an empty diff; and the replay-mode "Custom problems need live mode" notice was asserted nowhere. **Fixed:** a diff test for indentation-only changes (mutation-checked) and an e2e assertion of the notice after picking "Your own". Lows accepted (the 75 s client-timeout text, single-fact research fixtures, zero-tested family rows, the reattackUnjudged==1 boundary, equivalent and past-cap mutants).
- **Judge/docs** CLEAN; two wording lows fixed (public vs library budgets in the README, "many commits ahead").

## Round 42 (2026-10-30, `03def0d`/`ba26bd1`, 4 parallel Sonnet/high audits; core and UI were cut off by the 5-hour usage limit around 01:00Z and resumed at 07:47Z)

Not clean: judge/docs and security CLEAN; core found 2 mediums and UI 1 borderline medium, all fixed in the next push.
- **Core** (2 mediums, both measured on the production executor — `Judge0Executor` against the real `sandbox/server.mjs`; the local executor hides them): `runWithRestarts` submitted a window's Judge0 chunks one after another, each its own sandbox round trip. (1) A correct solution on a pasted-statement problem (1000 ms limit, chunks of 14) ran out of the 50 s wall clock before its families were judged (`budget_exhausted`, f5 at 64/300, mutations and baseline never reached). (2) A solution hanging on ~10% of inputs lost its confirmed timeouts when the clock ran out mid-window and ended `budget_exhausted` with no counterexample. **Fixed:** on the shared-limit (Judge0) path, once a chunk has come back clean the next 3 same-size chunks run concurrently and their results are used in order (inputs are independent, so the outcomes are unchanged); the first chunk that ends early (a hang or a crash) turns this off for the rest of the run, so hanging inputs cost what they did sequentially in submissions, plus at most 2 discarded prefetches (the pinned 60-submission timeout test is unchanged; on a slot-starved sandbox those can still cost some wall clock). Re-measured on the real sandbox: the correct solution now gets `no_counterexample` with every family judged in 28 s, and the 10%-hang solution is reported as a counterexample (fix honestly "not verified in time"). Unit test: a clean run overlaps PREFETCH_CHUNKS chunks with identical, ordered outcomes and no wasted submission; the local executor stays one chunk at a time. The local benchmark is unaffected. Lows: the time-box trace warning can fire when maxEvals and the box end together (cosmetic); solo-confirmed timeouts are not kept if the deadline fires mid-window.
- **UI and tests** (1 borderline medium; ~390 applied mutants, no shipped wrong-data bug): the share codec was only ever exercised with a counterexample report, so deleting `research.error` from the schema survived (a shared link of a failed-research report would say "found no facts"). **Fixed:** a share test round-trips a no-counterexample report (null time to first counterexample, unpriced stages), an `oracle_unreliable` report and a failed-research report; mutation-checked.
- **Security** CLEAN (sandbox unchanged since round 35; BPF re-derived; uid separation, server logic, route, share links, SSRF and secrets held; below-bar platform notes on core-pattern pipes, keyctl without a runtime profile, and MAX_PROCS x slots on 8+ CPU hosts).
- **Judge/docs** CLEAN; a historical HANDOFF heading retitled.

## Round 41 (2026-10-29/30, `b32a1fd`, 4 parallel Sonnet/high audits; all four reported)

Not clean: core, security and judge/docs CLEAN; UI found 4 medium test gaps (no shipped wrong-data or a11y bug), fixed in the next push.
- **Core** CLEAN: the round-40 shrink time box verified (checked before every non-empty batch, stops with the best-so-far and honest "may not be minimal"; an injected clock through the real attack never produced a wrong claim); on the real sandbox all 16 correct bench solutions gave no_counterexample, the 5 demos shrank to their expected minimal input with verified fixes. Lows: confirmHits re-runs every hang alone; the box reserves nothing explicit for explain/re-attack (a hang attack can end "fix not verified in time", honestly); the box is checked only between batches; and the time-box trace warning fired even when shrinking finished — **that last one fixed** (it now fires only when the box cut shrinking short). The rest accepted.
- **Security** CLEAN (sandbox byte-identical to round 36; the time box adds no attack surface; route, guards, SSRF, share links and secrets held).
- **UI and tests** (4 medium test gaps; ~1,400 applied mutants): `toMarkdown` was never run on a report without a counterexample, explanation or fix (a guard mutant pasted "undefined" or threw on "Survived the attack"); the share-link defaults for links made before `shrinkExhausted`/`reattackUnjudged` existed; AttackUI's `HeroText` mode wiring (replay could claim a live model); AttackUI's `ProblemBrief` wiring (every chip could show the first problem's brief). **Fixed:** a Markdown test for a counterexample-free report; a share test that decodes a legacy link and checks the defaults; the e2e checks the replay hero text and that the shown statement and examples match the server's catalog for the first problem and after picking Integer square root. The unit fixes were mutation-checked. Lows accepted (FixView with a null diff, the route's PUBLIC_BUDGETS constant pinned only by value, a share clamp boundary, contrived fixture coincidences).
- **Judge/docs** CLEAN (full reconciliation incl. replaying all built-ins and VIDEO figures); one low fixed (HANDOFF's 2026-10-24 section marked historical).

## Round 40 (2026-10-29, `3e1b90b`, 4 parallel Sonnet/high audits; all four reported)

Not clean: security and judge/docs CLEAN; UI found 3 mediums (fixed in `fc09689`) and core 1 medium (fixed in the next push).
- **Core** (1 medium, measured against the real `sandbox/server.mjs` through `Judge0Executor`; no false alarm and no missed bug across 62 hand-written solutions on both executors, harness differential fuzz, small-scope exhaustiveness and shrinker 1-minimality checks): on the production executor, shrinking a hang or a wide-range-int bug could spend the whole 50 s wall clock — each candidate that still hangs costs a full time limit (more in a shared-limit submission) and candidates went 16 at a time — and when the budget ran out mid-shrink the shrinker's best-so-far input was lost: the attack ended with the unshrunk input, `shrinkSteps: 0`, and no explanation, fix or re-attack (`binary-search/bug-c` and 6 of the 8 hard-tier bugs on the sandbox). The local-executor bench hid it. **Fixed:** shrinking is time-boxed to half the wall clock left when it starts and keeps the smallest failing input found so far (`shouldStop` in `shrink()`, traced), and a timeout hit shrinks two candidates at a time. Unit test (the time box keeps progress and judges nothing after it) and an integration test (a hang under a 20 s wall clock still gets an explanation and a fix; fails without the fix). Benchmark regenerated. Lows accepted: no cross-round memo of passing candidates (repeats cost evals, not correctness); a pasted Node script's `require.main === module` block runs at load; `export { solve as default }` is not stripped.
- **UI and tests** (3 medium test gaps; ~700 applied mutants, no shipped wrong-data or a11y bug): the diff's minimality (a valid but non-minimal diff showed 16 changed lines for a 2-line fix), the route's `routing` passthrough (the Ultra-only baseline could silently run routed), and AttackUI's statement and examples render. **Fixed:** the diff test checks the "same" lines against an independent LCS; an api test posts both routings through the route; the statement and examples are a pure `ProblemBrief` component, unit-tested. Each was mutation-checked. Low accepted: the custom-problem branch's `research` passthrough (live only).
- **Security** CLEAN (sandbox unchanged since round 36; BPF, uid separation, ReDoS sweep, route and share links held). Below-bar note: `/run/lock` and `/var/lock` are not in the shared-dir lock list; the image's build-time chmod and `--read-only` cover them.
- **Judge/docs** CLEAN; lows fixed (round-agnostic "rounds 34 onward", the local-executor caveat in NEBIUS-SANDBOX, this file's header note).

## Round 39 (2026-10-29, `5afbb44`, 4 parallel Sonnet/high audits; all four reported)

Not clean: core, security and judge/docs CLEAN; UI found 1 medium, fixed in `bea675c`.
- **Core** CLEAN: the round-38 probe-skip fix verified (the skip is set in one place and never for small-scope/examples); nine correct JS/Python solutions and ~100 random specs (correct and buggy) gave no false alarm, no error and no non-conforming counterexample. Lows accepted: small-scope is empty for `distinct` arrays with len >= 4 (3 element values); an O(value) oracle on a large-range int can end a correct attack `budget_exhausted` (honest, not a false claim); a tiny-domain model family can still be probe-skipped (small-scope covers those shapes).
- **Security** CLEAN: the BPF re-decoded, run isolation, launcher limits, server auth, route/guard, SSRF, share links and secrets held; `tests/integration/sandbox.test.ts` 22/22. Lows accepted (multi-threaded CPU contention bounded by RLIMIT_CPU; a non-attacker-triggerable spawn-error timer; failed live calls charged a flat amount).
- **UI and tests** (1 medium; ~85 applied mutants): `src/app/page.tsx` mapped each built-in to the statement, examples, language and demo code the page shows, and no test imported it (statement->title, language->"python", code->bug all survived; the e2e's language check was circular). **Fixed:** the mapping is `uiProblems()` in `src/app/ui-problems.ts`, unit-tested field by field against the catalog. Lows also closed: the trace why-span kind check and the research error/empty exclusivity.
- **Judge/docs** CLEAN; lows fixed in `a06ed6c` (sandbox concurrency arithmetic "about 5", consistent "over 600 tests", the current commit range main lacks, the old soak table kept as a labelled reference).

## Round 38 (2026-10-29, `c54e490` / core on `af35a1e`, 4 parallel Sonnet/high audits; the core audit was cut off by the 5-hour usage limit and resumed after the 20:40Z reset)

Not clean: judge/docs CLEAN (the round-37 robust figures held) and security CLEAN; UI found 2 mediums and core 1 medium, all fixed in the next push.
- **Core** (1 medium, reproduced end to end): the probe-skip rule ("the oracle failed every input of the opening probe, so skip the rest of the family") assumed a family's inputs are the same shape throughout. Small-scope is enumerated shortest-first, so its first 4 inputs share an empty first argument; a model oracle that crashes on `[]` (e.g. `nums[0]`) failed the probe and the whole 300-input small-scope family was dropped, missing a bug only small-scope reaches (`no_counterexample` where the correct answer was `counterexample`). **Fixed:** only independently drawn families (model, mutation, baseline) can be skipped; `exhaustive` and `examples` never are, so only the inputs the oracle cannot judge are lost. Regression test reproduces the case and is mutation-checked (fails without the fix). No benchmark family ever had an oracle skip on small-scope/examples, so the benchmark is unchanged. Lows accepted: a pasted statement's 1000 ms limit makes Judge0 chunks of 14 inputs (~2.3x the built-ins' submissions; real round-trip latency unmeasured, BLOCKED.md); an output-cap straddle that is practically unreachable; probe-skipped families undercount unrun inputs in the message.
- **UI and tests** (2 medium test gaps, verified by applying the mutants): the HTML model-routing step cell (`s.purpose` -> `s.stage` survived, since the asserted row had stage == purpose) and the copied Markdown's totals line (`usd(stats.costUsd)` -> another field survived). **Fixed:** the generators row's step cell and the Markdown totals line are asserted, plus a priced Markdown routing row. The round-37 extraction was confirmed by 8 applied mutants, all killed.
- **Security** (0 medium; one low): an aborted attack's sandbox submissions keep running to their time limit, so rapid connect-and-abort can briefly fill the sandbox queue (bounded by the per-IP limits). README's load note now says so instead of "a fast 503 instead of a pile-up".
- **Judge/docs** (0 medium; lows fixed: a historical typo and an un-annotated round-34 line in this file).

## Round 37 (2026-10-29, `e6a0cdd`, 4 parallel Sonnet/high audits; all four reported)

Not clean: core and security CLEAN again (core re-read the whole run stage/judge/compare/shrinker/budgets and ran stateful-bug and stateful-oracle probes; security re-verified the syscall table and found CPU-fairness already bounded by the memory sizing). UI and judge each found one medium, both fixed in the next push.
- **UI and tests** (1 medium wrong-data gap + the structural AttackUI-coverage class): the headline minimal-counterexample input (`<code class="big">solve(...)`) in report-view.tsx was pinned by no test, so a mutant rendering `r.counterexample.original.args` (the UNSHRUNK input) under "Minimal counterexample" survived — verified by applying it (43/43 tests still passed), and it shows wrong data for 3 of the 5 built-in demos. The same class covered the live-trace time cell value and the problem-examples line, because AttackUI (a stateful client component) is mounted by no test. **Fixed:** a report-view unit test pins the `.big` input is the shrunk args, not the original; and the trace-event row and the example row were extracted into pure components (`src/app/trace-view.tsx`: `TraceEventLine`, `ExampleLine`) with a unit test that pins each field with distinct values (time=ms(e.t) not seq, stage not kind, msg not stage/kind, why not purpose/model, example args-then-output). This closes the recurring "AttackUI inline rendering is e2e-only" source of UI findings. The round-36 e2e assertions still pass (the extracted DOM is identical).
- **Judge/docs** (1 medium + lows; every benchmark figure, constant, command, path and a fresh replay of all five built-ins otherwise reconciled): the WIN-CHECKLIST test count had drifted (615 vs the actual 616, now 621). Rather than chase the exact number every round, the churny summary figures were made robust — WIN-CHECKLIST now says "over 600 tests", and the round/issue counts in SUBMISSION and break-it are "more than 35 rounds … more than 150 issues". Also fixed: the BLOCKED submit-date wording; a reaudit round-34 "Update" line now marks the doubling design "superseded in round 35". (reaudit's `AUDITED_COMMIT` header and break-it's `TESTED_COMMIT` are re-stamped at the freeze, per HANDOFF.)
- **Accepted lows (core):** `confirmHits`/`orderDependentHit` re-check each non-reproducing hit serially, so a faulty stateful live-model oracle that yields many unconfirmed mismatches could exhaust the remote wall clock and return `budget_exhausted` (not a false bug claim) — pre-existing since round 25, unusual fault, left as-is; the family "mismatches" stat counts unconfirmed hits (cosmetic, verdicts unaffected); a non-timeout probe hit does not stop the rest of its window (the accepted round-35 item).

## Round 36 (2026-10-29, `ef8f22b`, 4 parallel Sonnet/high audits; all four reported)

Not clean: core and security CLEAN (both verified the round-35 fixes thoroughly — the probe-first-window run stage on five points incl. a mutation check of the new regression test; the ptrace denial by hand-decoding and simulating the BPF and a live EACCES run, with no sibling escape). UI and judge/docs found fixable items, all addressed in the next push.
- **UI and tests** (3 test gaps; no a11y or wrong-data defect; the round-35 UI fixes verified to kill their mutants): the `trace.jsonl` download content was pinned only by line count and JSON-parseability, not the event fields (a mutant writing `e.msg`/`e.data`/`{seq}` per line survived); the live trace's per-call "why" span was pinned only as non-empty (a mutant printing `e.data.purpose` or `e.data.model` survived); a shared report's absent "Share link" button was pinned by nothing (dropping the `onShare &&` guard would render a dead button). **Fixed:** the e2e now asserts each downloaded line is the full event object and the first message matches the screen; asserts the first `.why` is a rationale sentence (has a space, no slash) not the purpose or model id; a unit test asserts the Share button shows on an own report and never on a shared one.
- **Judge/docs** (2 medium, several low; every benchmark figure, constant, command and path otherwise reconciled, including a fresh replay of all five built-ins and a `longest-path.ts` re-run): (M1) `src/lib/agent/stages.ts`'s `RUN_FIRST_CHUNK` doc comment and a test comment still described the superseded "doubling sub-batches (4,8,16,32,64)" design as current — **fixed** to the probe-first-window-then-whole-windows design the code actually runs. (M2) BLOCKED.md and SUBMISSION.md described the repo as if PR #1 were unmerged, and `main` (the default branch) is ~7 commits behind `counterexample`, with no PR #2 and the repo still private — **docs corrected** (PR #1 is merged at `d56dcf0`; the remaining owner steps are to merge PR #2 or set `counterexample` as default, and make the repo public, both in BLOCKED.md). Lows fixed: SUBMISSION rounds 34->36; break-it rounds 35->36 and the "378 property tests" wording; the WIN-CHECKLIST audit list extended through round 36 and its freeze date corrected to 2026-10-30 10:00Z; NEBIUS-SANDBOX's denied-syscall list now names ptrace and the legacy AIO calls; the screenshots-README capture date; WIN-CHECKLIST:147 no longer claims SUBMISSION states the not-minimal count.

## Round 35 (2026-10-29, `f8cabfb`, 4 parallel Sonnet/high audits; all four reported)

Not clean: 4 NEW mediums, one per dimension, each verified by the main session and fixed in the next push. Several of them are side effects of the round-34 run-stage change, which is exactly what a re-audit of a fix is for.
- **Core** (1 medium, 5 low): the round-34 sub-batching judged **every** 64-input window in doubling sub-batches (4,8,16,32,64), so every attack made ~4.5x as many executor submissions (measured 257 vs 57 pre-fix on `binary-search/correct`). On a remote executor (the only kind production allows) those extra serial round trips can themselves exhaust the 50 s wall clock and wrongly return `budget_exhausted` on a **correct** solution — a false alarm, the worst failure for this tool. The local-executor bench hid it (no round-trip cost). **Fix:** probe only the first window of each family (RUN_FIRST_CHUNK then the rest of the window); once a window runs clean, judge the rest of the family a whole window per call. Both round-34 protections still fire on the first window's probe. Measured 257 -> 71 executor calls (pre-fix 57; inputs tested and `runs` identical to pre-fix, so verdicts/costs/load are unchanged). Regression test added: average batch size must stay above RUN_CHUNK/2, so re-probing every window cannot silently return. The auditor's 5 lows (flaky-timeout window remainder skipped; timeouts after the first sub-batch still cost up to size x limit; oracle-skip can trigger on a non-opening sub-batch; order-dependent bugs see fresh processes more often; the load-line doc) are accepted as before — bounded and unlikely, and the doc line already hedges.
- **Security** (1 medium; the hardened sandbox re-probed, the route/guard/share links/regex stalls, git history): `ptrace` was not in the denied syscalls. A Python run could call `ptrace(PTRACE_TRACEME)` then `SIGSTOP`; the stop is reported to the server's `waitpid`, which libuv reads as a plain exit, so the handle is dropped and the SIGKILLed process becomes an **unreapable zombie owned by the server** — one per submission. ~100 submissions on a slot uid then break every Node run on that uid (NPROC 64), and ~500 exhaust the documented `--pids-limit 512` and take the whole sandbox down (the `/health` check still passes, so the container is never restarted). Reproduced locally against the real root-mode server. **Fix:** deny `ptrace` (x64 101, arm64 117); regression test asserts EACCES. Everything else held (BPF decoded by hand; fork/clone3/socket/namespaces/NNP/rlimits all verified; no SSRF; href safety; constant-time auth; token deleted from env; no secrets in history).
- **UI and tests** (2 medium test gaps; no a11y or wrong-data defect; axe clean in 4 width/theme combinations across 8 states): the "Copy report" Markdown routing row's `calls` column was pinned by a fixture whose `calls`/`promptTokens`/`completionTokens` were all 1 and whose `stage` equalled `purpose`, so a mutant reading the wrong field stayed green; the live trace's per-event time/stage/message spans were asserted nowhere (the headline artifact). **Fixed:** the Markdown fixture now uses distinct values and asserts the row; the e2e asserts every trace event shows a formatted time (not a raw number), a stage label and a message, and that the message is neither the stage nor the event kind; the shared banner's problem title is cross-checked against the Markdown title (not its id).
- **Judge/docs** (1 medium, 3 low; every headline figure, command and referenced path otherwise reconciled against `fixture.json` and the code): README and WIN-CHECKLIST cited a hard-tier "not minimal" count that had drifted from the committed fixture (the count varies run to run; the docs said "3 … one or two string ones" against a fixture showing 2). **Fixed** to track the committed fixture, and re-synced after the round-35 bench regen (which, on the probe+rest run stage, shows 3 of 8: the two DAG graphs and one word-break string, within the documented 2-to-4 band). Median time-to-first-counterexample also moved back toward the pre-round-34 figures (routed 5.4 s / Ultra 11.3 s), updated in README (auto-generated block), SUBMISSION and WIN-CHECKLIST. Low, fixed: SUBMISSION "33 rounds" -> 34; WIN-CHECKLIST "611 tests" -> 613; README layout list now names NEBIUS-SANDBOX, SUBMISSION and screenshots/.

## Round 34 (2026-10-29, `d5e09fa`, 4 parallel Sonnet audits; core and security completed, UI and judge stopped by the account's 5-hour usage limit before reporting; the limit reset at 15:30Z, after the 15:00Z submission deadline)

**Update (2026-10-29, fix on `0d4def7`, bench regenerated on `b5e1b18`):** both core mediums are fixed — this first fix judged each window in doubling sub-batches (4,8,16,32,64), so an all-timeout family is confirmed after a few inputs and a family whose oracle fails on its opening sub-batch is skipped; regression tests added; the built-in demos and the benchmark verdicts/costs/load are unchanged (only timings and hard-tier strings vary). **Superseded in round 35** (see the round-35 entry above): the doubling probed every window and multiplied remote submissions, so it was reworked to probe only the first window of a family and then judge whole windows.

Not clean: core found 2 NEW mediums (OPEN at the deadline). Security was clean.
- **Security** (0 findings): the round 32-33 sandbox hardening holds — fork/vfork/non-thread clone, legacy AIO, sockets, namespaces, mounts and inotify denied; threads and normal runs work; single-process memory bounded; no cross-run harm; route, guard, share links, compare CPU and 118 commits of history all held.
- **Core** (2 medium, OPEN; 1 low recorded): both are wrong-verdict risks in the hard-tier hang-detection feature when a live model generates an all-worst-case family (the shipped benchmark families mix sizes and are unaffected):
  1. a run-stage chunk of 64 inputs is judged in full before any hit is examined, so 64 timing-out inputs cost 64 x the time limit and the attack ends `budget_exhausted` instead of reporting the counterexample (at the 1,000 ms limit a pasted statement gets, 64 s > the 50 s wall clock);
  2. a brute-force oracle too slow on one large family stalls the whole attack, so later families never run and a bug is missed (same chunk-granularity root cause).
  - **Not fixed before the 15:00Z internal milestone (fixed afterwards: `0d4def7`, reworked in round 35).** The sound fix — judging the run stage in sub-batches and probing each family's oracle on its first few inputs — changes `inputsTested`/`runs` on every bug solution, which rewrites the benchmark figures the README, fixture, SUBMISSION and VIDEO all cite. Landing that, regenerating the benchmark and fully re-verifying it could not be done safely before that milestone, so at the time the findings were recorded with reproductions and a fix plan; the CONTINUE directive then had it landed and the benchmark regenerated (round 35).
  - low (recorded): the smallscope property test does not scale its timeout with FC_NUM_RUNS (a test-infra limit, not a product defect).
- **UI and judge:** did not report (usage limit). Round 33's UI and judge were clean apart from the test gaps and doc lows fixed in `d5e09fa`.

## Round 33 (2026-10-29, `0a20cea`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean (core 1 borderline medium, UI 3 medium test gaps). Security and judge were clean. Fixed in the next push.
- **Core** (1 borderline medium, 2 low): the shrinker's result for a non-monotone integer rule (divisibility, leap year) is only locally minimal, yet the report says "minimal counterexample" with `shrinkExhausted` false; a smaller unrelated failing integer can exist that the halving moves never reach. **Decision:** this is the standard property-testing meaning of "minimal" (no single reduction step still fails). Changing the integer shrinker risks the carefully verified bench minimality right before the freeze, so the README now defines "minimal" precisely where the shrinker is described (locally minimal under the reductions; a non-monotone integer rule can have a smaller unrelated failing value). Not treated as an open defect. Low (accepted): one wide-range integer burns most of the shrink budget (the report already says "may not be minimal"); the smallscope property test does not scale its timeout with FC_NUM_RUNS.
- **Security** (0 medium; fork denial verified to hold — Python/Node and threads run, fork/vfork/subprocess/clone3 denied; single-process memory bounded; route, guard, share links, compare CPU and 114 commits of history held):
  - low, fixed: a run could call `io_setup` and fill the host-global AIO pool (`aio-nr`), starving other containers on the same kernel; the filter now denies the legacy AIO calls (io_setup/destroy/getevents/submit/cancel). low, fixed: `RLIMIT_CORE` was raisable, so a crash could invoke a host core-pattern pipe; `ulimit -c 0` is set now. low, fixed (doc): the sandbox doc gives the `MAX_CONCURRENT` × memory ratio (about 6 at 2 GB and the 256 MB default).
- **UI and tests** (3 medium test gaps, 3 low; axe clean in every state, hostile links, keyboard, 118+ mutants):
  - medium (test gaps): the diff's direction (a reversed `lineDiff` showed the fix as removed and the submitted code as added), the "still fails on 1 of N" fix summary (the one-mismatch boundary, the common case), and the full-fix view's tab stop, role and accessible name were pinned by nothing. Tests added: the diff test asserts the removed line is the submitted code and the added line is the fix; `fixSummary` is pinned at one mismatch; the e2e opens "Show full fix" and axes it and checks its named tab stop, and a unit test checks the shared-vs-own region names differ;
  - low, fixed: a crafted share link with an unbreakable huge number scrolled the page sideways at 320 px (`.stats b` now wraps); the trace's research-source link is pinned to `target="_blank"` so a click during a run does not navigate the tab away;
  - low (accepted): Markdown totals omit the cost, the share-link read-only/select-on-focus, spellCheck, and a few wording/CSS mutants of the accepted kinds.
- **Judge** (0 medium, 2 low fixed: the WIN-CHECKLIST test count 605 -> 611, and a stale sandbox-doc note that said "12 verdicts" for what is now a four-configuration run; everything else — 606 tests, full bench verdicts/costs/load line, every README and VIDEO figure, constants, the sandbox syscall list, screenshots and sponsor docs — reproduced).

## Round 32 (2026-10-29, `6cafaa3`/`77b5b15`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean (security 1 medium, UI 3 medium test gaps). Core and judge were clean. Fixed in the next push.
- **Security** (1 medium; the hardened sandbox probed for memory the per-run limit misses, the route, guard, share links, compare CPU, 113 commits of history):
  - medium: a run could `fork` up to `MAX_PROCS` children, each allowed `RLIMIT_AS` of `memory_limit`, so a fork burst reached the whole 2 GB container before the 50 ms RSS sampler caught up (measured 1.4 to 2.0 GB from one run, OOM-killing other runs). **Fix:** the seccomp filter denies `fork`, `vfork` and any `clone` without `CLONE_THREAD`, so a run is one process bounded by its single `RLIMIT_AS`; threads still work (`clone` with `CLONE_THREAD` passes, `clone3` returns `ENOSYS` so the C library falls back to the checked `clone`). Verified against the rebuilt image: Python and JavaScript run, Python threads and Node workers run, `fork` and `subprocess` are denied (EACCES), the 30-child memory attack is denied at the first fork, a single process over its limit is still killed, and preflight and two bench problems pass. Tests updated for the single-process behaviour; the docs say what it rules out (asyncio, multiprocessing, child_process).
- **UI and tests** (3 medium test gaps, 3 low; axe in 42+ states with zero violations, hostile links, keyboard, touch, 240+ mutants; the UI behaviour was correct in every case):
  - medium (test gaps): the attack-families "mismatches" column, the per-step cost column of the model-routing table, and the "Shaped generator families" line (shown only when there is at least one family) were pinned by no test, so a mutant reading the wrong field stayed green. A new test renders a report with all-distinct values and asserts every families cell, every model-routing cell (including the per-step cost against the run total), every stat tile and the single-family line; it kills all three mutants and the low ones below;
  - low (fixed by the same test): the "why" column (rationale), the shared-vs-own region names and the replay footnote's `some` condition.
- **Judge** (0 findings; fresh clone with 605 tests, 12 e2e steps, full bench verdicts, costs, load line and every constant reproduced, the sandbox network filter, screenshots and sponsor docs all matched).
- **Core** (2 low, none medium; 605 tests, FC_NUM_RUNS=1000, bench problems, pair-by-pair exact-mode checks, full attacks with real processes): low (accepted/doc): JSON cannot tell an integer-valued float from an integer, so two such answers beyond 2^50 that differ by rounding count as different unless the problem is marked `float` (now in the README); the float tolerance is a fixed 1e-6 and does not read a looser tolerance from the statement (now in the README).

## Round 31 (2026-10-29, `68d1c6a`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean (core 1 medium, UI 3 medium test gaps). Security was clean (no findings); the judge is recorded when it reports. Fixed in `330b588` (core) and the next push (UI).
- **Core** (1 medium, 3 low; 604 tests, FC_NUM_RUNS=1000, bench problems, deep answers):
  - medium: round 30's switch to float mode happened only after the oracle had returned a fraction, so a batch of perfect squares was still judged exactly and a correct bisection sqrt was reported broken; the switch was also sticky, so a verdict could depend on which inputs ran first. **Decision:** comparison is per pair, with no state: in exact mode, a pair where either side holds a non-integer number gets the standard float tolerance (1e-6, absolute below 1 and relative above), and two integers or big-integer markers must match exactly. The judge's switch is removed. Tests with real processes: the bisection agrees on perfect squares alone and in any company, a bisection to 1e-2 and an `isqrt` off by one are mismatches; unit tests keep 2^52 against 2^52 + 2 a mismatch in exact mode (float mode tolerates it). Three earlier assertions encoded the old 1e-9 and 1e-12 gaps and were moved to values beyond 1e-6 (1.5 against 1.501, 0.3 against 0.3001, 50000.5 against 50000);
  - low (accepted): float mode's tolerance is absolute below magnitude 1 (1e-7 against 0 agrees), the usual "absolute or relative error" rule; a `/` against `//` bug shows only on inputs below about 5e5 (small-scope and random inputs reach those).
- **Security** (0 findings; the hardened sandbox with about 30 more syscalls probed, `memfd_secret` counted in RSS and capped by RLIMIT_MEMLOCK, the route, guard, share links, parsing bounds and 109 commits of history all held).
- **UI and tests** (3 medium test gaps, 3 low; axe in 486 states with zero violations, big integers exact everywhere, 43 unit and several e2e mutants):
  - medium: the research citations (fact text and source link) were tested nowhere; the e2e now checks that the first run's trace and report cite each fact with an https link, and a unit test pins the fact and its link;
  - medium: "Show full fix" was never checked to show the fix; the e2e now checks that the full view holds the corrected loop and not the submitted one;
  - medium: the stat tiles other than "inputs attacked" were unpinned; the unit test pins sandbox runs, model calls and the shrink's family name;
  - low (accepted): "Your own" keeping the code box, the share link's read-only and select-on-focus, the code box at 14 px (iOS may zoom on focus), no `color-scheme` declaration (native scrollbars stay light in dark mode).

## Round 30 (2026-10-29, `e17f6d6`, 4 parallel Sonnet audits; the security, UI and judge audits were stopped by the usage limit before they reported)

Not clean (core 1 medium). Fixed in the next push; round 31 re-audits everything on it.
- **Core** (1 medium, 5 low; full bench verdict counts identical, 200,000 random integer pairs through `parseExact` and `outputsEqual` with no divergence from BigInt equality, reflexivity and symmetry in all modes):
  - medium: a float problem with a stated tolerance whose examples are whole (sqrt with 4 -> 2) and whose spec left `compare` out still compared exactly, so a correct bisection to 1e-7 was reported broken. The judge now decides from behaviour: once an exact problem's oracle returns a non-integer number, the rest of the attack compares as floats, and the trace says so. An integer problem's oracle never returns a fraction, so it stays exact (test with real processes: the bisection agrees, an `isqrt` off by one is still a mismatch);
  - low, fixed: exact mode's rounding gap was 1e-9 with an absolute floor of 1e-9 below magnitude 1, which let a `/` against `//` bug on numbers from 5e8 pass; it is now 1e-12 relative with a 1e-15 floor near zero (summation-order differences are about 1e-16 relative). Tests: `500000000.5` against `500000000` is a mismatch, `0.1 + 0.2 - 0.3` against `0` is not;
  - low, fixed: the float-literal check looks only at the examples kept (the first ten, without unsafe integers), and its note says "the model did not ask for float"; an answer nested about 1,500 deep is a model-output error, not a crash;
  - low (accepted): the unordered modes do not tolerate one-ulp differences (float lists in unordered problems are rare); in float mode, a big integer in an example alongside a `3.0` is compared with float mode's tolerance.

## Round 29 (2026-10-29, `df31d50`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean (core 2 medium, UI 1 medium). The judge was clean; security's one finding is rated low here (below). Fixed in `f08b791` (security) and the next push.
- **Security** (1 finding, rated low by the main session; pipes, pty pairs, inotify and the shared temp dirs tried under the documented flags; route guards, share links, the float regexes on 8,000-character statements, and the full history held):
  - low, fixed: unread inotify event queues held about 85 MB of kernel memory per run that the RSS-based limit does not count. The auditor rated it medium, by analogy with `socketpair`. It is rated low here because, unlike `socketpair` (about 900 MB per run, other runs OOM-killed), it is bounded by per-user kernel limits (128 instances, 16,384 queued events each), like the pipe buffers accepted in round 28, and four concurrent runs reached 388 MB of the container's 2 GB with no run killed. It was cheap to close: the filter denies `inotify_init`, `inotify_init1` and `inotify_add_watch` (test; image rebuilt; preflight passes in both languages).
- **Core** (2 medium, 2 low; full bench verdicts identical, FC_NUM_RUNS=1000, regex cost at most 0.14 ms):
  - medium: round 28's float inference turned an explicit "exact" into "float" on words in the return type or the statement ("int (the decimal value)", "floating-point is not accurate enough"), and float mode compares integers from 2^50 with a tolerance, so a Fibonacci overflow at n=79 was missed;
  - medium: the tolerance phrases it recognised were too narrow, so the common wordings ("within 10-5", "0.0001", "to 3 decimal digits") still gave the original false bug on a correct mean;
  - both fixed by a sounder rule: only an example output that holds a fraction or is written with a decimal point (2.0) switches a problem to float mode; no wording does. Exact mode itself now takes two non-integer numbers within 1e-9 relative for one answer (a sum in another order), while integers, big or small, and markers stay exact. Tests: the Fibonacci, "decimal value" and "floating-point" cases stay exact and catch the low-digit bug; one-ulp float differences agree; real differences, off-by-one integers and big integers in their low digits still mismatch. One earlier assertion (`0.3` against `0.1 + 0.2` is a mismatch in exact mode) encoded the old rule and was replaced by `0.3` against `0.3000001`;
  - low, fixed: a reviver overflowing the stack on JSON nested thousands deep is caught in the float check; low (accepted): the README does not describe float mode's 2^50 boundary beyond the code comment.
- **Judge** (2 low; fresh clone with 602 tests, 12 e2e steps, full bench rows identical to the fixture, every README and VIDEO figure, constant and sandbox syscall reproduced, sponsor docs match): low, fixed: the bench time now says 12 minutes idle, 15 loaded; WIN-CHECKLIST says where rounds before 4b are detailed.
- **UI and tests** (1 medium, 4 low; axe in 102 states with zero violations, a full contrast sweep, keyboard, touch at 320 px, hostile links, 48 mutants):
  - medium: nothing tested that the trace shows the newest event during a run, or that it scrolls at all. The e2e now paces a run, waits until the trace overflows while Cancel is shown, and checks it shows the newest event after the next one arrives; the mutant that scrolls only when the report arrives fails it;
  - low, fixed: the e2e checks that the picked chip is filled differently, that "Your own" reads pressed once picked, and that the trace, table and diff regions show a focus outline; unit tests pin the `usd` boundary and the live research text in full;
  - low (accepted): absurd numbers in a crafted share link print in exponent notation (the banner says a link can say anything).

## Round 28 (2026-10-29, `f158efa`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean (security 1 medium, core 1 medium, UI 3 medium). The judge was clean. Fixed in `b5d1ca5` (security) and the next push.
- **Security** (1 medium; the hardened sandbox with the documented flags, the route in-process against it, the guard read in full, share-link decode and render bounds, no secrets in 104 commits):
  - medium: AF_UNIX `socketpair` buffers are kernel memory charged to the container but to no run's RSS, so one run held about 900 MB under a 256 MB limit and three runs pushed the container into its OOM killer, killing another user's run. The seccomp filter now denies `socketpair` (Python and Node start without it); a test checks EACCES, the image was rebuilt and runs both languages (preflight and two bench problems against it), and docs/NEBIUS-SANDBOX.md says what it rules out (asyncio, child_process).
- **Core** (1 medium, 4 low; full bench verdicts identical, the README table reproduced, 3,000 random specs, end-to-end probes of stdin, `sys.exit`, huge prints, BigInt, stateful solutions and a mid-shrink wall clock):
  - medium: a model's spec that left `compare` out made a float problem whose examples all have whole answers (a mean, "2.0") compare exactly, so a correct solution that sums in another order was reported broken. The understand stage now compares as floats when an example output is written as a float (2.0, 2500.00000), when the return type says float or double, or when the statement gives a tolerance (1e-5, "absolute or relative error"); float mode still compares integers below 2^50 exactly. Tests for each, with the note that says why;
  - low (accepted): "judged inputs" counts an input each time a family repeats it in a tiny domain; a timeout counterexample at the time limit can fail its final re-check and fall back to the unshrunk input (the README now says 5 of 8 hard-tier ones were seen not minimal on a loaded machine); a wall clock that ends mid-shrink reports the unshrunk input; a module that hangs at import time is reported as a timeout on the first input.
- **Judge** (2 low; fresh clone with 605 tests, 12 e2e steps, full bench verdicts, costs and load line identical, README and VIDEO figures, constants and sponsor docs all match): low, fixed: the hard-tier "not minimal" range (5 of 8 on a loaded machine) and the JSON-mode wording in FEEDBACK and FRICTION.
- **UI and tests** (3 medium, 3 low; trace scrolling by wheel, keys, touch, zoom and resize; axe in 64 states with zero violations):
  - medium: a resize or rotation clamps the trace's scroll position, which the direction-based logic read as the reader scrolling up, so the trace stopped following for good; medium: nothing tested the follow reset between runs. **Decision:** the stop-following behaviour came from a round-26 low and has produced two rounds of mediums, so it is removed: the trace shows the newest event as it arrives, as before round 26. The full trace stays readable after the run and is downloadable as `trace.jsonl`. The round-26 low ("the trace forces itself to the bottom during a run") is accepted;
  - medium: the e2e border check read only the colour, so a border of width 0 passed. It now counts a border that is not drawn as 0:1; the width-0 mutant fails the e2e;
  - low, fixed: the research explanation now says live mode needs `TAVILY_API_KEY` (without it no search runs and the report says so), and an unknown mode says what each case does; the e2e checks the text after a failed status check;
  - low (accepted): boundary-tolerance mutants of the removed follow logic (moot now).

## Round 27 (2026-10-29, `5cd3d06`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean (UI 3 medium). Core, security and judge were clean under the criterion. Fixed in the next push.
- **Core** (3 low, none medium; full bench verdicts identical, FC_NUM_RUNS=1000 on two seeds, 600,000 texts through `parseExact` with no divergence, 150 random judge trials with timeouts and process splits, 0 misplaced):
  - low (accepted): in a first chunk of very verbose outputs, the 8 MB output cap can kill a process before the judge has learned how many results fit, so one input is unjudgeable (or a false mismatch that the solo re-run drops); no false bug is claimed, and this predates round 26;
  - low (accepted): once runs are cut to what fits, `ranBefore` and an order-dependent `sequence` assume the original batch; it needs a stateful solution with results over about 125 KB each;
  - low, fixed: the stateful-oracle test took 21 to 29 s against a 60 s timeout and timed out under load; its timeout is 180 s now (also found by the judge and UI audits).
- **Security** (2 low, none medium; the hardened sandbox with the documented flags: sockets, namespaces, mounts, memfd, userfaultfd, bpf and keyctl denied, memory and fork bombs killed; 2,000,000 fuzzed texts through `parseExact` with no divergence; worst parse 90 ms; the route's content type, body and guard checks; no secrets in 104 commits):
  - low (accepted): hostile verbose output makes runs of 3 to 6 inputs, about 21 times the sandbox processes of a normal solution; runs are still charged (at most 1.7 times steady), inside the wall clock, concurrency cap and run budget; the README notes it;
  - low (accepted): the `retry[0] === 0` guard cannot trigger (a run always reads its first result); kept as a guard against a future executor.
- **Judge** (1 low; fresh clone with 602 tests, 12 e2e steps, full bench verdicts, costs and load line identical, every README and VIDEO figure and every constant reproduced, sponsor docs match, PR #1 and the owner steps as BLOCKED.md says): the stateful-oracle test timeout (fixed, above).
- **UI and tests** (3 medium, 4 low; axe in 96 states with zero violations, contrast recomputed, keyboard order, hostile links, 47 mutants):
  - medium: the trace re-followed when the reader scrolled down past where the last automatic scroll had left it, however far the bottom had moved. Following is now decided by direction: a scroll up stops it, and only reaching the bottom (or the bottom as it was one render ago, for End followed by an event) resumes it. It is a pure function with unit tests;
  - medium: nothing tested following. The e2e now paces a run, wheels the trace to the top, scrolls to the middle and presses End, checking where it stays each time; the mutant without the scroll handler fails it;
  - medium: nothing tested the field borders. The e2e computes each field's border contrast on its card (code, statement, language select, share link) at 390 and 1280 px in light and dark, and needs 3:1; the mutant that puts them back on `--line` fails it;
  - low, fixed: the research explanation no longer claims a web search while the mode is unknown or loading (it says what happens with and without a Tavily key, like the hero text);
  - low (accepted): chips and ghost buttons have 1.3:1 borders, but their labels are text (WCAG treats text-only buttons as identified by their text); the h1 overflows by a few pixels at 320 px with WCAG 1.4.12 text spacing (same as the accepted text-spacing item).

## Round 26 (2026-10-29, `657c696`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean (security 1 medium, UI 6 medium; core and judge clean under the criterion). Fixed in `da03f2a` (core and security) and the next push (UI). A full bench on the fixed judge gave the fixture's verdicts.
- **Security** (1 medium, 2 low; the hardened sandbox image with the documented flags and with seccomp unconfined; the new denylist holds and Python and Node threads, subprocesses and workers still run):
  - medium: round 25's re-run of unread results re-ran the rest of a 64-input chunk once per result read, so verbose outputs (about 97,000 characters each) charged 576 runs for a chunk instead of 128. The judge now cuts later runs to as many inputs as fitted and grows them back after runs that fit: at most 320 for the first such chunk and 192 after (test with real processes);
  - low, fixed: `parseExact` accepted an unquoted integer of 16+ digits as an object key; it now leaves it for JSON.parse to refuse (also found by core; tests);
  - low (accepted): a stateful solution's order-dependent check costs a few hundred runs, inside the run budget.
- **Core** (7 low, none medium; full bench verdicts identical, FC_NUM_RUNS=1000 on two seeds, 600,000 texts through `parseExact` against the reviver, 3,000 random judge batches with correct placement):
  - low, fixed: the retry keyed on the message text, so a JavaScript solution that threw that text was retried until the wall clock. The parser now sets a flag that output cannot forge, and a refusal of a run's first result is never retried (test);
  - low, fixed: an oracle that answers differently in order was reported as flaky execution and cost one in-order oracle run per hit. One in-order run per batch is shared, and the trace names the oracle (test);
  - low, fixed in docs: the README says unread results are judged again in fresh runs, and that state is blamed only when the oracle answers the same in order as alone (and that the original process split holds unless results were too large for one run);
  - low (accepted): `oracleStable` reads no results past a run's total budget (the hit is dropped, conservatively); a JavaScript `Math.pow(2, 70)` is unequal to a Python oracle's `2.0 ** 70` in exact mode (related to the accepted 2^64 item).
- **Judge** (5 low, none medium; fresh clone with 597 tests, 12 e2e steps, full bench verdicts and costs identical, every README and VIDEO number reproduced, the Docker sandbox with the documented flags, sponsor docs match, soak 164 attacks with 0 unsound):
  - low (final step): WIN-CHECKLIST cites `break-it.md`, which is written at the final commit with the gate;
  - low (decision recorded): BRIEF says "Don't run `next build` locally". Read as the owner's machine: this cloud container runs it for the browser e2e and the gate's checks, and the required pre-push checks (lint, typecheck, test) run before every push;
  - low (final step): `bench/results/soak.md` and the README soak table predate the hard tier; both are regenerated at the final commit with `pnpm soak`;
  - low (final step): FC_NUM_RUNS=5000 passed every test but a vitest worker timed out under four auditors' load; it is rerun on a quiet machine at the final commit.
- **UI and tests** (6 medium, 4 low; axe in 60 built-in states plus 14 synthetic verdicts and the 404 page with zero violations, 21 hostile links, keyboard traversal, 82 mutants):
  - medium: the statement box's only visible label was its placeholder, at 4.1:1. Placeholders use the muted colour now (5.3:1 light, 7.5:1 dark), the box has an accessible name, and the e2e runs axe on "Your own" and checks both;
  - medium: text fields, the language select and the share link had borders of 1.3:1 (WCAG 1.4.11). They use a field colour of 4.0:1 and 4.5:1 now;
  - medium: the research option's new explanation said it searches the web in replay mode, where no search runs. It depends on the mode now (unit test, and the e2e checks the replay text);
  - medium: the 404 page's link was untested; the e2e follows it home;
  - medium: Attack's disabled state during a run was untested (a second click on its left half would start a second run); the e2e clicks there mid-run and counts one request;
  - medium: the unit test of section headings accepted a missing one; it now pins the exact ordered list, and each form of the counterexample heading;
  - low, fixed: the trace stops following new events once the reader scrolls up, and follows again at the bottom or on a new run; the footnote's "(the time to first counterexample includes it)" shows only with a counterexample; a nonzero cost below $0.000005 shows as "<$0.00001";
  - low (accepted): ten more wiring and label mutants survive (examples' outputs, backtick spans, the trace button's disabled state, a group name, the footer link, the client timeout constant), of kinds accepted in earlier rounds.

## Round 25 (2026-10-29, `8281d1f`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean (judge 1 medium, core 2 medium, UI 4 medium, security 1 medium). The judge, core and UI fixes are in `1b66231` and `f0f9e8d`; the security fixes follow. A full bench on `f0f9e8d` gave the same verdicts as the fixture.
- **Judge** (1 medium, 4 low; fresh clone with 588 tests, 12 e2e steps, full bench verdicts and costs identical, every README and VIDEO figure reproduced, official docs match): medium: the README spend-cap sentence still said `MAX_CONCURRENT_ATTACKS` is 4 (fixed in `1b66231`); low, fixed: the load bullet now names the 2-attack cap as the first limit hit, the Vercel line is hedged, SUBMISSION counts 25 rounds, WIN-CHECKLIST has round 24, the diagram no longer says a file is written.
- **Core** (2 medium, 9 low; full bench verdicts identical, FC_NUM_RUNS=1000, 128 correct-solution attacks on 8 seeds, 40,000 fuzzed answers and specs):
  - medium: results refused only because a run's earlier results used its 1,000,000-character budget counted as oracle failures, so a correct solution with large outputs (running sums of 10^4 values) got `oracle_unreliable`. The judge now judges those inputs again in fresh runs (each run reads at least its first result, so it ends; the runs are charged). Test with real processes: 24 results of 110,000 characters all agree, and a real difference among them is still found in place; it fails without the fix;
  - medium: an oracle with a module-level memo made a correct solution's mismatches reproduce in order, and the run blamed the solution ("keeps state between calls"). The solution is now blamed only when the oracle answers the input the same after the earlier inputs as alone. Test: the stateful binary search as the oracle and a correct solution gives no order-dependent claim, the mismatches are dropped as not reproducing; it fails without the fix;
  - low, fixed in docs: the README now says generated graphs can be disconnected and have parallel edges and self-loops (unless DAGs), and that return values must be JSON values (a Python `set` is a runtime error, a JavaScript `Set` arrives as `{}`);
  - low (accepted): `fitValueCap` gives up on several large lists or a list inside a tuple (the attack then fails with a clear message); integer-valued floats from 2^64 up no longer equal their exact ints (an example written `1e20`); `"sorted": true` and "ascending" are not read leniently; a draft JSON object before the answer fails the schema; 64-bit bounds in a model family reject that family (small-scope still covers the bounds); example arity is not checked (the oracle is blamed); "judged inputs" counts repeats in a small domain.
- **Security** (1 medium, 4 low; the real route with a fake Token Factory, the Judge0 executor and the hardened sandbox container; guard, lease, secrets and sandbox isolation held):
  - medium: when the solution and the oracle both return maximal results (1,000,000 characters per process of deep arrays with one 16-digit integer, which sends them through the exact-integer reviver), both parses and the first compare landed in one event-loop turn: 0.7 s for one attack, 1.0 to 1.3 s of lag with two. Exact parsing no longer uses a reviver: unsafe integer literals are rewritten as marker strings, outside JSON strings, and the text gets a plain parse. 1,000,000 characters of that shape now parse in 65 to 110 ms instead of 310 to 350 ms. Tests: a property test (500 runs by default, 20,000 run once) shows the result is identical to the reviver's on JSON text with integers up to 330 digits, floats, exponents and strings full of digits, quotes and escapes; invalid text is still refused; a timing test needs at least 3 times less CPU;
  - low, fixed: the sandbox's seccomp filter now also denies unshare, setns, mount, pivot_root and chroot, so a run cannot hold memory in a tmpfs of its own where the runtime's seccomp profile is missing (test: each returns EACCES). clone with CLONE_NEWUSER is left to the runtime's profile;
  - low, fixed: the class-method check used `^\s*` over multiline text, quadratic on blank lines (20,000 newlines cost 0.4 s); it is `^[ \t]*` now;
  - low, fixed: the README's concurrency sentence (also found by the judge) and the memory guidance, which now says two attacks at the caps peaked at 1.9 GB for the whole process and asks for at least 2.5 GB for a 2-attack instance.
- **UI and tests** (4 medium, 4 low; every built-in at 390 px, 14 bad links, touch at 280 and 320 px, axe in 10 states with zero violations, 37 mutants):
  - medium: the "to first counterexample" tile showed a time on a compile-error report (every example "mismatched" when the code never loaded) and did not mark replayed (simulated) latency. The report now has a time only when it shows a counterexample, and a replayed time carries the `*` of the footnote, which says it includes simulated latency (unit and integration tests);
  - medium: the report's sections were styled text, not headings. They are `h3` now, so screen readers can jump between them (unit test, and the e2e lists the headings of a compile-error report);
  - medium: four verdict headings had no test, and no browser test rendered a report without a counterexample. A unit test pins every verdict's heading, and the e2e renders a compile-error report (heading, the "–" tile, section headings, axe at 390 and 1280 px, light and dark);
  - medium: the download check could not fail (its fixture had no oracle). The fixture now carries the oracle's code and a trace; the mutant that saves the raw report fails the e2e;
  - low, fixed: an unknown address gets the app's own 404 page (status 404, a "404" title, a main landmark; axe in the e2e); the research option's explanation is shown under it and tied to the checkbox, not left in a tooltip (e2e);
  - low (accepted): ten mutants of wiring and labels survive (example outputs, the trace file name, the full copied text, the cost column's "unpriced", `rel=noreferrer`, the mismatch colour, a group name); a crafted link of under 8,000 characters can show a 512 KB counterexample (no overflow, and the banner warns that a link can say anything).

## Round 24 (2026-10-28 to 29, `77ca989`, 4 parallel Sonnet audits, paused 23:00 to 00:30 by the usage limit; findings verified by the main session)

Not clean (security found two medium items). Judge and core were clean under the criterion.
- **Judge** (1 low, none medium; full bench verdicts and costs byte-identical, fresh clone with 583 tests and 12 e2e steps, every README and VIDEO number reproduced, official docs match): three replay messages still said "recorded"; they say "hand-written".
- **Core** (4 low, none medium; full bench verdicts identical; FC_NUM_RUNS=1500 on two seeds; sync and async generation identical under concurrency; order-dependent and entry cases hold):
  - low (round-23 regression at the cap): 10^4 words of up to 20 letters counted 200,001 values once the list counts, and failed the attack. The understand stage now shortens the longest list to fit, with a note (test);
  - low (accepted): `extractJson` can take a closing fence of an earlier code block as an opening one when a model quotes code before its JSON (falls back to the first balanced object; not typical output); the fallback note calls a method "not defined" when a top-level `solve` wraps it (verdicts right); an entry written as prose ("a function called isValid") can match a top-level function named like an English word.
- **Security** (2 medium, 3 low):
  - medium: integer-valued doubles such as `1e300` were expanded to their 301 digits four times per result (about 1.1 s of CPU per tick, every chunk). Exact digits are now built only below 2^64, where the overflow bugs they exist for live (test: 31,000 of them compared in all modes under 500 ms);
  - medium: retained inputs (`tested` and the fix stage's copies) reach about 860 MB for one attack at the DSL caps and 3 GB for four. The default `MAX_CONCURRENT_ATTACKS` is now 2, and the README states about 1 GB per concurrent attack. Keeping digests instead of inputs is the structural fix, left for after the hackathon;
  - low (accepted): the sandbox's seccomp filter does not deny `unshare(CLONE_NEWUSER)` (network stays denied; container defaults apply); Tavily searches are outside the model spend cap (2 per attack at most, under the per-IP limits); upstream error text (300 characters) and the sandbox host reach clients.
- **UI and tests** (5 medium test gaps, 7 low; every flow, 13 hostile links, touch at 280 px and crafted reports pass axe with no overflow; the shipped behaviour was correct):
  - medium: the report's content was unpinned (message, expected/got labels, explanation, shrink steps, inputs attacked, tested per family, calls and tokens per stage, the "why" line, the Markdown sections). Unit tests now render the report with distinct numbers and check each in its place, and the Markdown section by section;
  - medium: the round-23 banner (verdict, caveat sentence, key) had no test. The e2e now checks the verdict and the caveat, and that a second report of the same problem and verdict (another run) is announced;
  - medium: the too-large download's content was unchecked; the e2e now reads the file and checks it holds no oracle code and no trace;
  - medium: Copy report on a shared report was unchecked; the e2e reads the clipboard there too;
  - medium: the run-start reset was unpinned; the e2e opens a shared link with a share link shown, starts a run, and checks both are gone;
  - low (accepted): the "why" check would pass on the text "undefined" (the unit test now pins the real text); `fragmentBudget` wiring; browser Back after a pasted link keeps the shared report; Markdown fences are not escaped for code containing triple backticks; "expected null" for a crafted link without `expected`; an uppercase `#R=` link is ignored; `validReport` optional-field mutants and the copy-failed text.

## Round 23 (2026-10-28, `9a9c561`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean.
- **Core** (3 medium, 5 low; full bench verdicts identical, 578/578 tests):
  - medium (false alarm): keeping every identifier of the entry let a parameter name win when a driver line assigns it (`nums = [...]` made `nums` the entry); medium (regression): "var rotate = function(nums, k)" took `k`, which the body reassigns, giving a compile error on correct code. The entry is now the first name the code defines as a top-level function; any other definition counts only for the first name (the one called or written first). Tests for both;
  - medium (documented limit): tree and linked-list inputs (a `TreeNode` solution receives a list) can blame a correct solution. The README's "Your own code" list now names node inputs, equal-length parallel arrays, and that the harness adds no imports;
  - low: `clampIntBounds` rewrote const values (dropped `sorted: false`, clamped `min`/`max` inside data) and did not lower `pool`. Consts are now kept exactly, and a pool past the length cap is lowered (test);
  - low (accepted): lenient flags apply to the understand answer only, not to model families (a rejected family leaves the others); strict JSON in model answers (no trailing commas or comments) with one understand call; parallel arrays (now listed).

- **Security** (1 high, 2 medium, 3 low):
  - high: `maxValues` and `checkCost` counted leaves only, and distinct retries were unbudgeted per family, so nested distinct singletons took 3 to 4.5 s per family tick and 1.9 GB for 8 families. Now: `maxValues` counts each list; a family may draw at most twice its value budget (discarded draws and lists included, `withDrawBudget`); and the stages generate with `generateInputsAsync`, which yields every 20 ms. The auditor's shape: 0.75 to 1.0 s of CPU per family in all, spread over 20 ms ticks (test: a family-wide cap, and the same inputs with or without yields);
  - medium: `ranBefore` recomputed the chunk's batches per hit (1.2 to 1.7 s). The batches are computed once per chunk;
  - medium: the fix stage serialised every input in one go when a sequence existed (1.2 s at 9M values). It uses `jsonKeys`, which yields;
  - low: the attack route took any content type, so a cross-site form could post without a preflight. It now takes `application/json` only (415 otherwise; test);
  - low (accepted): ticks of 0.6 to 1.0 s at the legal maximum in sync helpers outside the stages; the spend reservation's token estimate for token-dense Unicode (not measurable without the tokenizer).
- **Judge** (7 low, none medium: clean under the criterion; fresh clone, full bench, e2e, the sandbox via `pnpm sandbox`, and the official docs all match): fixed the round count, the checklist's rounds 21 to 23, Token Factory named in the video's voice-over, the bench's running time and `--only` in the README, the EvalPlus wording, the graph and text limits, and that edited built-ins in replay must keep `solve`.
- **UI and tests** (7 medium, 8 low; 0 axe violations in 40 states; every flow and 16 hostile links readable; a full bench on `66a5f5c` gives the same verdicts as the fixture):
  - medium: the report hid `research.error` and empty research (a shared report has no trace). It now says "Research did not complete: …" or "The searches found no facts to use." (unit test);
  - medium (a11y): a second shared link of the same problem was silent (the banner text depended on the title only). The banner now names the verdict and is keyed on the link;
  - medium (test gaps, all now covered by the e2e): two Share clicks give two announcements; Copy report puts the Markdown report on the clipboard; a refusing clipboard gives "Copy this link…"; a report too large for a link is downloaded and says so; the shared banner is a status region; the executor badge, the model calls' "why" lines and the examples list are on the page;
  - low: a fixed length past the cap lowers its minimum too (test);
  - low (accepted): the verdict below the fold on a phone after a run; text-spacing overflow of a long stage label; a chip re-click discards edited code; Copy report omits research and families; a compile-error report lists untested families; the "Your own needs live mode" warning untested; a refused re-run clears the earlier report, and its retry time is in seconds.

## Round 22 (2026-10-28, `876e650`, 4 parallel Sonnet audits, paused 17:00 to 19:30 by the usage limit; findings verified by the main session)

Not clean (core, security and judge each found a medium-or-above item).
- **Core** (4 medium, 6 low):
  - medium (false alarm): `entryName` took "Solution" from "Solution().maxProfit" and "target" from "var twoSum = function(nums, target)", so the fallback attacked a later helper. The entry now keeps every identifier in the text and takes the first one the code defines; `paramCount` splits parameters at bracket depth 0 (`Dict[int, int]` is one). Tests for both forms and for typed generics;
  - medium (stall): `paramCount`'s JavaScript pattern had two space runs around the generator star (2 s CPU at 80 KB). One run now (test under 500 ms);
  - medium (design gap): statements whose constraints the DSL cannot state (several valid answers, rectangular rows, a length parameter, in-place changes with no return value) can make a correct solution look wrong. The README no longer says an over-eager generator "cannot cause a false alarm"; it lists these cases under "Your own code" with how to phrase such a problem, and the understand prompt tells the model to make the examples show the answer this code returns. Accepted as documented limits;
  - low: `randInt` on the symmetric full safe range returned only odd values; ranges wider than 2^53 now split into halves (test);
  - low: `sorted: false`, `pool: 0` and "unordered-nested" failed an understand answer; they are now read as unset and as `unordered_nested` (test);
  - low (accepted): a 1000 x 1000 grid is refused at the 200,000-value cap (the prompt states it); a model family over the length cap is rejected whole; a distinct string array that fills its domain is more often short; the test count in WIN-CHECKLIST (updated).
- **Security** (1 high, 2 low):
  - high: `jsonValues` counted a nested list as its leaves only, so `[[[[[0]]]]]` was one value and a family of them took 5.6 s of CPU and 411 MB (1.6 GB end to end). Every list and object now counts as one plus its contents, which every budget uses (the auditor's shape: 614 ms, 66 MB);
  - low (accepted): singleton nested arrays of ints cost 0.7 to 1.4 s per family, within about twice the accepted bound;
  - low: the local executor lets pasted code read the server environment (documented: it is not a sandbox and production refuses it). `.env.example` now warns next to `ALLOW_LOCAL_EXECUTOR`.
- **Judge** (1 medium, 2 low):
  - medium: WIN-CHECKLIST cites `break-it.md`, which is written on the final commit with the evidence runs (fresh clone, FC_NUM_RUNS=5000, the soak, the Docker sandbox). Until then the citation points ahead; HANDOFF lists it as the last step before the gate;
  - low: test count (updated); "over a thousand when nothing breaks" holds for 13 of 16 correct solutions (588 to 1,547): the README now says "hundreds to over a thousand".
- **UI and tests** (3 medium, 7 low; 0 axe violations in 72 states, wcag22aa target size included; announcements once each; 20 report kinds round-trip through share links; touch, keyboard and reflow at 280 px hold):
  - medium (test gap): nothing pinned the alert's key, which makes a repeated same-message bad link announced. The e2e now counts inserted alert nodes for the repeat;
  - medium (a11y): a second Copy report or Share link with the same text was silent. Each note is now a new node in its live region (a counter key), and the e2e counts two announcements for two copies;
  - medium (test gap): the graph node and edge caps had no test; one now lowers n <= 10^5 and m <= 2 * 10^5 to the caps;
  - low: the e2e now checks that picking a problem clears a `#r=2.` link;
  - low (accepted): generator guards pinned only in combination; the wide-range integer test checks parity and low bits; other single-mutant survivors (graph arity counting, unsafe integers inside objects, a spurious note at the cap, link-version regex variants); link messages for a trailing character; a redundant status sentence; identical verdict headings for a shared and an own report; identical source-link names; no feedback when pasting the same link again (no hashchange fires).

## Round 21 (2026-10-28, `2ab4d46`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean (core found medium items).
- **Core** (5 medium, 5 low), each reproduced by the auditor's script:
  - medium: an understand `entry` in any other form ("def solve(x)", "solve(x: int) -> int", "Solution.solve", "`solve`", "") failed the attack. The entry is now the identifier before the first "(", else the last identifier, else none (the code decides); it is only ever an identifier;
  - medium: lengths, node and edge counts past the DSL caps (a statement's n <= 10^5) failed the attack. They are lowered to the caps with a note, as integer bounds are;
  - medium (false alarm): the last-function fallback picked a trailing `main()` or helper. It now prefers the last function that takes as many parameters as the problem passes, and never `main`;
  - medium (wrong verdict): example arguments past 2^53 reached the oracle rounded, so a perfect oracle "never matched the examples". Such examples are left out of the check with a note (all of them unusable is a clear error);
  - medium (stall): a `distinct` array of a large const retried 100 cloned draws, and nested infeasible `distinct` arrays multiplied the retries (17.9 s). Generation now caps a distinct array of a const at one element, and one input's draws (discarded ones included) at 800,000 values (test under 1 s CPU);
  - low: `"compare": null` or "Exact" failed; now read as the default and case-insensitively;
  - low: `nondecreasing` tuples of strings or lists were sorted with `a - b` and then dropped; they sort with `compareJson`;
  - low: ranges wider than 2^32 left the low bits constant (no odd values on [0, 2^53)). `randInt` combines two draws there;
  - low: `extractCode` edge cases (a column-0 line inside an indented fence, a tagged test block beating an untagged fix, `solve =` in a comment): rare, accepted;
  - low: the WIN-CHECKLIST test count: updated.
- **Judge** (4 low, none medium; full bench, fresh clone, 12 e2e steps, official docs and the API runs all match): the round count in SUBMISSION (updated); the test count (updated); the UI copy still says "dozens to hundreds of inputs" (changed with the final screenshots); `checks.sh` said "recorded model answers" (now "hand-written stand-ins").
- **Soak (`pnpm soak --all --seeds 3`, 1,509 attacks):** 1,435 killed, 72 survived, 0 missed, 0 errors, and 2 "unsound". Both were the same equivalent mutant of `hard/decode-ways/bug-a` (an exponential solution), claimed as a timeout on the 29-character input while the machine ran the soak, two auditors and a bench (load about 10). Re-run on a quiet machine it takes 334 ms of its 500 ms limit there: a real, machine-dependent timeout, not a false alarm. The soak's checker compared values only. It now confirms a timeout claim when the mutant times out again or needs at least half its limit, and the README says so. The soak is rerun on the final commit (this run predates the round-21 generator changes).
- **Security** (4 high, 2 low), all model-written-spec shapes whose real cost the budgets did not count. Fixed at the spec, where they enter:
  - high: a nested const counted as one value but cost its depth per copy (70 s at depth 50; 5 GB at depth 1000); high: shrinking measured an object as one node (12.7 s in one tick); high: small-scope sized a const object as 1, so 20,000 combinations each serialised a 17 KB key (over 7 minutes). A const is now at most 1,000 characters of JSON and 8 levels deep (`parseTypeSpec` refuses more); shrinking measures objects by keys and values; small-scope sizes an object by what it holds;
  - high: the `distinct` retry loop multiplied under an outer array (14 s for 10,000 pairs of a const). A distinct array of a const holds one element (round 21 core), one input's draws are capped, and a short distinct array now gives up after 2n + 8 misses (test under 500 ms);
  - low: a ConfigError echoed `JUDGE0_URL` or `JUDGE0_AUTH` values to API callers; it now names the variable only (test);
  - low: an attacker with a /48 can rotate /64s for fresh rate-limit buckets. The spend cap and concurrency cap still bind: accepted (fairness, not cost).
- **UI and tests** (3 medium, 4 low; 0 axe violations in 9 more states at 320 to 1280 px; announcements delivered once each):
  - medium: the status region kept "Attack started…" after a failed run, and a retry was then not announced. A run that ends without a verdict now clears it (the alert announces the error), with a reducer test; the e2e checks the region's `aria-live`;
  - medium: a second bad link failing the same way was neither scrolled into view nor announced. The share state counts failures, and the scroll and the alert node key on that count (reducer test, and an e2e paste without reload);
  - medium: the e2e did not exercise three echo-guard branches, and nothing pinned the windows. The e2e now double-taps Space, double-clicks Attack's right edge, and cancels deliberately at 400 ms; the unit tests pin 600 and 300 ms;
  - low: `#r=2.` stayed in the address bar, and a cut-short `#r=1` was called "a newer version". Any `#r=` link is cleared, and a cut-short one is called incomplete (test);
  - low (accepted): an ignored echo gives no feedback (by design: a click cancels from 300 ms, a key from 600 ms); the forced-colors chip grows by its thicker border; CSS-only features have no test; the statement box is named by its placeholder (axe passes).

## Round 20 (2026-10-28, `d15cb74`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean.
- **Core** (4 medium, 2 low), each reproduced by the auditor's script:
  - medium (false alarm): when the model's entry name was not in the code, the fallback took the first top-level function, usually a helper (a correct isqrt was blamed through its `clamp`). The fallback now matches the name spelled another way (integerSqrt for integer_sqrt), then `solve`, then the last top-level function; a JavaScript `const solve = memoize(...)` counts as a definition;
  - medium: an understand answer with an entry written as a call, more than 10 examples, a long reference or parameter name, or a 10^18 bound failed the whole attack. These are now read (the call's name, the first 10 examples, text shortened, integer bounds lowered to 2^53 - 1 with a note), and the prompt states the limits;
  - medium (missed bugs): `distinct` arrays that fill most of their integer range (permutations) gave up after 100 duplicate draws and were dropped (97 of 100 at n = 300). They are now drawn without replacement;
  - medium (coverage): small-scope `oneOf` elements came from the first option only (no nulls in a nullable array). Options now take turns;
  - low: small-scope strings use the first 3 characters of the alphabet. That is the documented ELEM_VALUES bound, and model families cover full alphabets (valid-parentheses bug-a in the bench): accepted;
  - low: `extractCode` took a test block after the fix, the first of untagged blocks, kept a list item's indentation, and missed info strings with attributes. It now prefers the last block that defines the entry (the solution's own name for a fix), applies the same rule to untagged blocks, dedents, and reads the tag from the info line (one linear run).
- **Security** (4 high, 1 low; on `d15cb74`, re-checked on `77f81d9`), each re-measured after the fix with the auditor's own scripts:
  - high: `conforms` checked string characters with `alphabet.includes`, about 3 µs per astral character (22 s in one tick for a 256-emoji alphabet). The alphabet is now a cached `Set` (0.46 s for the same shape);
  - high: a `const` compared by serialising both sides, and a `distinct` array keyed every element by its JSON (4.4 s for a const of floats). Consts now compare in place (`jsonEqual`, key order free), distinct numbers and strings go straight into a `Set`, a distinct array of a const can hold one element, and `nondecreasing` tuples compare with `compareJson` instead of JavaScript's `>` (0.57 to 0.66 s for the audit's worst shape, within the accepted bound);
  - high: object keys inside a `const` were not counted, so a 20 KB answer made 100 MB inputs (a 96 s stall, 4.8 GB RSS). `jsonValues` now counts keys by length, so that spec is refused at the value cap;
  - high (regression in `77f81d9`): two new regexes had adjacent space runs (`extractCode`'s JS entry pattern, the understand entry normaliser): 7.5 to 7.8 s at 60,000 spaces. Both now have one run (tests under 300 ms CPU);
  - low: behind a proxy that appends `ip:port`, each connection got its own rate-limit bucket. `ipBucket` drops the port (and IPv6 brackets) first.
- **UI and tests** (5 medium, 12 low; 0 axe violations in 16 states x 4 combinations with best-practice rules; touch, mouse, Space and restart timing confirmed):
  - medium: a double-click on Attack's right edge (Cancel appears there) cancelled the run it started, on mouse and touch. And low: a double Enter on Cancel cancelled and then restarted. The echo guards now cover all inputs: Cancel ignores a key press or click burst within 600 ms of the start and a single click within 300 ms (a double tap); Attack ignores anything but a single click within 600 ms of a cancel (unit tests; the e2e cancels after 700 ms, as a reader would);
  - medium: the scroll to a pasted share link hid the error for a bad link above it. The error is now what scrolls into view. And low: a `#r=2.` link was ignored silently; it now says the format is not one this page reads. A new e2e step pastes both while scrolled down and checks the message and its position;
  - medium: no test caught the judge ignoring `problem.compare` (all built-ins are exact). A judge test now gets "agree" for a reordered list under unordered and "mismatch" under exact;
  - medium: a failed `/api/problems` check could be shown as "Live" with no test failing. The e2e now fails the check and requires the "Server mode unknown" badge;
  - low: forced-colors mode lost the picked chip; it now gets a thicker Highlight border and bold text;
  - low: nothing was announced when a run started; the status region now says so;
  - low: `extractCode`'s "last defining block" and the public 50 s wall clock now have tests;
  - accepted (low): 200% root font at 320 px; the remaining UI and lib mutation survivors listed in the report (copy texts, footer, link attributes, shrinker quality tweaks, server pins, the over-large-diff path); the racy U07 check. They change wording, styling or a limit by one unit, or are covered by type checks, without changing a verdict.
- **Clean-round criterion (decision, recorded here):** every round so far, mutation testing and hostile review have produced new low-severity items, and they will keep doing so. From round 21, an audit counts as clean when it finds no new verified defect rated medium or above (no false alarm, missed bug, stall over 1 s, security hole, broken flow or untrue claim). Low items are fixed when cheap, or recorded and accepted. The gate's open critical and high counts are kept separately.
- **Judge** (7 low; fresh clone, full bench, replay runs and the official docs all match):
  - low: the README soak table was an earlier, base-tier run. It is regenerated on the final commit with `pnpm soak --all --seeds 3 --readme` (this push carries the rerun if it finished; otherwise the note stays);
  - low: WIN-CHECKLIST's test count and missing rounds 19 and 20 are updated;
  - low: WIN-CHECKLIST's "needs network access" now says only the keys are missing;
  - low: VIDEO's shot list ran to 2:50 against a 2:45 target. The closing card now ends at 2:45;
  - low: the cost figures rest on third-party list prices. README and SUBMISSION now say so, with the prices;
  - low: "dozens to hundreds of inputs" understated attacks on correct solutions (1,000+). README and SUBMISSION now say "up to a few hundred before the first counterexample, over a thousand when nothing breaks";
  - low: the README's longest-path figures had no script. `bench/longest-path.ts` reproduces both.

## Round 19 (2026-10-28, `58dbebe`, 4 parallel Sonnet audits, paused 05:50 to 09:38 by the usage limit; findings verified by the main session)

Not clean.
- **Security** (2 high, 1 medium, 1 low). One root cause for three of them: nested `oneOf` multiplied the cost of checking a value, and small-scope, a model family checked against the problem's spec, and shrinking each counted values only. Fixed at the root:
  - high: small-scope conform-checked up to 20,000 combinations at 25,600+ steps each (27 to 33 s in one call; a full attack stalled 37 s). high: a cheap family checked against a costly problem spec (2.2 s per family, 8 stalls of 2 to 4 s). low: shrinking spent 6 times the CPU. Fix: `fanOut` caps the alternatives a value can have, across nested `oneOf`s, at 16 (`parseTypeSpec` refuses more), so checking costs at most 16 times the values every budget already counts; small-scope also weights each parameter's size by its fan-out. The audit's small-scope shapes now take 6 to 22 ms (test under 500 ms CPU);
  - medium: `extractCode`'s two adjacent space runs (`[ \t]*` before the tag, `[ \t\r]*` after) split a long run of spaces every way: 2.7 s at 40,000 spaces, 63 s at 200,000. The tag and its spaces are now one optional group (test: both whitespace shapes under 300 ms CPU).
- **Core** (1 medium, 4 low):
  - medium: the same `extractCode` regex (fixed above);
  - low: a method named as the entry was refused even when a top-level `solve` wraps it, and a nested function (no class) was called a method. The refusal now needs a class and no top-level `solve`;
  - low: a quoted faulty line in its own block was taken as the fix. `extractCode` now takes the last block in the language that defines a function;
  - low: a draft fence closed by `</think>` at the end of a line (not alone on it) still hid the trace. A `</think>` that ends a line now ends the open fence; a fix with such a line is cut there, the rarer failure;
  - low: strings compared and measured in UTF-16 units, not code points as Python does (astral alphabets only). `compareJson` and `conforms` now use code points.
- **Judge** (1 medium, 7 low):
  - medium: SUBMISSION's Tavily answer said research runs when the code calls a risky API; in auto mode that only adds a suggestion. Both places now say research runs when the statement cites sources or the user ticks "Research the web";
  - low: "hundreds more" re-attack inputs is "hundreds to over a thousand more" (738 to 1,290 measured);
  - low: "17 rounds" in SUBMISSION is now 19;
  - low: the README's "Your own code" now says a pasted problem needs a live key and what replay mode reports for a class Solution;
  - low: stale network claims (README live section, SUBMISSION, BLOCKED) now say only the keys were missing from 2026-10-27;
  - low: the form screenshot shows the old hero copy: regenerated with `pnpm screenshots` in this push;
  - low: WIN-CHECKLIST's "3 to 4 of 8" is "2 to 4 of 8", as in the README;
  - low: a keyless `pnpm start` answered every attack with a bare "Server unavailable."; the missing-sandbox error is now a ConfigError, so the API names the remedy (JUDGE0_URL, or ALLOW_LOCAL_EXECUTOR=1).
- **UI and tests** (3 medium, 6 low); 44 axe states clean, keyboard and touch clean, the new double-click fix holds:
  - medium: no automated accessibility check, and six a11y mutants (labels, `lang`, `aria-pressed`, the trace scroller, contrast) survived. `axe-core` is now a dev dependency and the e2e runs it on the form, a report, a report with its share link shown, and a shared report at 390 and 1280 px, light and dark, plus explicit checks for `aria-pressed` and the trace scroller. It found a real violation straight away: a shared report opened above the reader's own gave two regions the same name (`landmark-unique`). The shared report's regions are now named "Shared report: …";
  - medium: the hashchange `view` bump had no test. An e2e check pastes a link while a share waits on a slow clipboard and expects the pasted link to stay in the address bar. The compress-branch checks (U04, U05) need a slowed CompressionStream and stay untested: accepted;
  - medium: the in-place array element mutation and the reverse arm had no test (L36, L37 survived). `mutate.test.ts` now requires both; each mutant fails it;
  - low: boundary survivors. Tests now pin the spend cap filled exactly (L28), the cost format at one cent (U20) and a judge batch exactly at the limit (L22). The rest (link, decode and hash caps, diff cap, a lone `\r`, semaphore floor, run and wall-clock budgets off by one, the exhaustive-integer limit, the depth early exit, ddmin chunk size, string measure and the shrink termination guard) shift a limit by one unit without changing a result: accepted;
  - low: a double-tapped Enter on Attack cancelled the run it started (focus moves to Cancel). Cancel now ignores a keyboard activation within 600 ms of the start (`echoesStart`; unit test plus e2e);
  - low: `isSingleClick` dropped a deliberate rapid click. Attack now ignores the second click of a double-click only within 600 ms of a cancel (`echoesCancel`);
  - low: a share link pasted into a tab showing a report opened 7,800 px above the reader. The shared report is now scrolled into view (e2e check);
  - low: "hundreds more on the fix": fixed in `52d5555`;
  - low: e2e waits of 5 s are now 15 s, so a loaded machine does not fail them.
  - Verified by mutation: rebuilding with each of 10 mutants (the six a11y ones, the hashchange `view` bump, both echo guards, the scroll into view) fails the e2e.
- Checks: lint, typecheck, unit and integration tests, build, and e2e (11 steps, with axe).

## Round 18 (2026-10-28, `2f70b6f`, core and judge Sonnet audits; findings verified by the main session)

Not clean.
- **Core** (3 medium, 3 low), each reproduced by the auditor's script and pinned by a test:
  - medium (false alarm): `sorted` on strings or lists used JSON-text order (`"a b"` before `"a"`, `[10,1]` before `[2,1]`), so inputs breaking the precondition were generated and accepted. `compareJson` now compares as Python does (numbers by value, strings by character, lists element by element);
  - medium (false alarm): `unordered` is top-level only, so 3Sum's inner triplets had to match in order. A new mode `unordered_nested` ignores the order of every list; the understand prompt says when to use which;
  - medium (false alarm): with `class Solution`, the entry fallback picked a helper defined above the class and blamed it. A method entry, or a class Solution with no top-level `solve`, now stops with a clear "methods are not supported yet" error;
  - low: on Judge0 the order-dependent count spanned several processes. The messages now say "fails only when run after N earlier input(s)" and the README says the replay splits over processes as the first run did;
  - low: a draft in the reasoning whose fence never closed swallowed `</think>`. A line that is only `</think>` now ends an open fence;
  - low: "``` python", "```python3" and "**EXPLANATION:**" are now read.
- **Judge** (1 high, 2 medium, 3 low):
  - high: `main` holds only `BRIEF.md`, `AGENTS.md` and `.agent/`, so the public repo link would show no README, code or `LICENSE`. Merging PR #1 (or making `counterexample` the default branch) is an owner step in BLOCKED.md and the SUBMISSION checklist (merging is the owner's call);
  - medium: SUBMISSION's routing speed claim did not say the replay latency is simulated. It now does, the bullet is "Routing costs about half", and FEEDBACK says the same;
  - medium: the replay trace said "recorded search results" for hand-written stand-ins. It now says "hand-written stand-in search results";
  - low: "hundreds of inputs" did not match the 29 to 195 "inputs attacked" tiles. The copy now says "dozens to hundreds of inputs, and hundreds more on the fix";
  - low: the hard-tier "not minimal" count is "2 to 4 of 8";
  - low: the SUBMISSION checklist says to drop `nebius-ai-cloud` if the sandbox is not deployed there.
- **Security, UI and tests:** not run this round (the round-17 security and round-16 UI audits were fixed in the same push).
- Checks: lint, typecheck, 548/548 tests, build, and e2e (10 steps, with the new double-click, held-Enter and late-share checks).

## Round 17 (2026-10-28, `a0570b8`, parallel Sonnet audits; findings verified by the main session)

Not clean.
- **Core** (1 medium, 2 low), each reproduced before fixing and pinned by a test:
  - medium: `codeSpans` paired every "```", so a fence mentioned mid-sentence in the reasoning swallowed `</think>` and the report showed the leaked trace. A fence now opens and closes only at the start of a line, as in Markdown;
  - low: a stray `</think>` before a complete `<think>…</think>` pair was no longer cut. The cut now runs on what is left once the pairs are removed;
  - low: once `Judge.compare` splits a chunk by value, an order-dependent failure counted inputs from earlier processes. `ranBefore` now takes only the inputs that ran before it in its own batch.
- **Judge** (1 medium, 3 low):
  - medium: `pnpm bench --live` with a bad key or an outage wrote its all-error zeros to `bench/results` and the README. Any run that ends in error now writes nothing, prints the first error, and exits 1 (checked with an unreachable Judge0 URL: "16 of 16 runs ended in error, so no results were written", exit 1). Error rows print their message;
  - low: SUBMISSION gave one size for all phone screenshots; it now gives each (the form, 390 x 1,574, needs no crop);
  - low: SUBMISSION's "14 rounds by 27 October" and the checklist's missing rounds 16 and 17 are updated;
  - low: `BRIEF.md` calls 2026-10-30 a Thursday; it is a Friday. The brief is the owner's, so it is left as written; the time (10:00 PT = 17:00Z) is right and every other doc uses Fri 2026-10-30 17:00Z.
- **Security** (1 high, 2 medium), each reproduced:
  - high: nested `oneOf` multiplied the work of `conforms` without adding values. `array(10,000) of oneOf(16 x oneOf(16 x int))` passed the value cap and stalled the event loop for 4 to 5 s. `checkCost` now bounds the checking steps per input like the values (200,000), and the family budget counts whichever is larger (test refuses that spec with 2,560,000 steps);
  - medium: work in single ticks. The mutation family serialised up to 400 large seeds in one go (1 s); the seed keys are now built in slices with yields. The other ticks the audit measured (generating one 500,000-value family, parsing one process's 1,000,000 characters of results, comparing one 256,000-character result) stay at a few hundred milliseconds at the caps. That is accepted as the bound and stated in the README's limits;
  - medium: the fence regex's `\s*\n` retried at every newline after an unclosed fence (2.2 s on 128,000 newlines). The info string now ends at the first newline (test: under 300 ms CPU; 4.7 s before).
- **UI and tests (round 16, on `b4f5c68`)** (2 medium, 3 low):
  - medium: a double-click on Cancel cancelled the run, and its second click landed on Attack, which grows into Cancel's place, starting a new attack. Attack now ignores the second click of a double-click (`isSingleClick`, unit test plus an e2e step);
  - medium: the Judge0 path's forged-record cap (`parseLines(stdout, chunk.length)`) had no test. A test with 2,000,000 forged records now kills the mutant (12 s of CPU without the cap);
  - low: the share race. Opening a shared link through hashchange now bumps `view`, and the compress and error branches check it before writing a note, a link or a download;
  - low: four round-15 UI mutants survived (held Enter past the run's end, `view` bump in `run()`, clearing the share note, Cancel focus). New e2e checks kill all four, each confirmed by rebuilding the mutant;
  - low: lib mutants. `Judge.compare` with a short oracle answer now has a test (ExecutorError, not TypeError). The event-loop yields (dedupe, per result, per family) and the small-scope `evenly` and per-parameter budget keep no dedicated test: a regression there costs time, not results, and `evenly` is equivalent to a prefix on every spec tried. Accepted.
- Checks: in the round-18 entry.


## Round 16 (2026-10-28, `b4f5c68`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean.
- **Judge** (1 medium, 2 low). A fresh clone gives 532/532, a full bench reproduces every count, and the official docs match. Fixed:
  - medium: `pnpm preflight` and `pnpm bench --live` ran under tsx and never read the `.env.local` the README tells the owner to write, so every live check was skipped. They now load `.env.local`, then `.env`, with shell variables winning (`scripts/load-env.ts`, unit-tested; checked end to end, where a key in `.env.local` now reaches Token Factory);
  - low: FEEDBACK named one Nano id; the docs also list `Nemotron-3-Nano-Omni`, which was removed in August. Both are now named;
  - low: the suggested Devpost thumbnail was a 390 x 6,018 page. `pnpm screenshots` now also captures `devpost-thumbnail-1200x800.png` (3:2), and SUBMISSION says to crop the phone shots.
- **Security** (1 high, 1 low). The round-15 fixes hold. Fixed:
  - high: the 200,000-values-per-input cap was checked per argument, so six large arguments made 1.2-million-value inputs. With shrink batches of 16 that meant 5 s stalls and 1.5 GB of RSS. `checkInputValues` now caps the sum across arguments, for model families and pasted problems alike. `Judge.compare` also splits batches at 250,000 values (`byValues`), so no executor call serialises megabytes at once;
  - low: `runStage` generated families back to back with no yield. It now yields between families.
- **Core** (3 low). The round-15 changes hold (20,000 sortJson cases, no races from the yields, and the bench matches). Fixed:
  - think tags inside code fences or inline code were treated as markup, which dropped or corrupted a fix that handles the literal tags. Tags inside code are now content;
  - the re-attack filter re-serialised every input even with no sequence. It is now skipped in that case;
  - Python 3.11+ refused to print integers of more than 4,300 digits, so such oracle answers went unjudged. The harness lifts the limit inside the sandbox process.
- **UI and tests:** pending.
- Checks: lint, typecheck, 539/539 tests, build, and e2e (10 steps).

## Round 15 (2026-10-27, `c90b859`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean.
- **Judge** (6 low). A fresh clone gives 523/523; the replay runs and a full bench reproduce every figure, and the Token Factory claims match the official docs. Fixed:
  - the UI copy still said "thousands of inputs" (`mode-copy.tsx`); it now says "hundreds of inputs (thousands of runs)". The screenshots are retaken on the final UI;
  - FEEDBACK and FRICTION said "about 150 chunks"; they now say 31 to 385 or more batches, median 57, from the bench;
  - the Sandboxes limits are now cited from the official limits page (50 simultaneous operations, 10 MiB per stream, no-network VMs);
  - BLOCKED's preflight step now names the exact detail to look for, since the check passes with a removal note before the date;
  - the unverifiable "judging 1 to 15 December" is removed (the Devpost dates page answers 403 here), and SUBMISSION now says 14 audit rounds, not ten.
  - Not fixed, by design: `LEASE` and `pids` stay tracked. The lease is the cross-session lock that the hand-off protocol commits and pushes, and the gate reads `pids`. Neither holds a secret.
- **Security** (3 medium, 1 low; synchronous stalls from steered inputs), fixed:
  - `sorted` generation serialised both sides of every comparison (10,000 nested arrays took 1.2 to 2.7 s). `sortJson` now serialises each element once; a property test shows it orders exactly like `compareJson`;
  - three smallest-first sorts in `stages.ts` did the same (22 inputs of 200,000 values took 4.1 s). `smallestFirst` now measures each input once;
  - `fixStage` regenerated every family and deduplicated in one tick (2.3 s). It now yields between families, and `dedupe` is digest-keyed and yields every 1,000,000 characters;
  - low: `Judge.compare` handled a chunk's results (up to about 0.6 s at the caps) in one tick. It now yields after each result.
  - Clean: the guard, the prompts, URLs, escaping, share decode, mutate, shrink and small-scope.
- **Core** (1 medium, 4 low), fixed with tests:
  - medium: a time bomb. From 2026-11-09, a preflight test using the real clock would fail (`pnpm test` in December). Every preflight test now has a fixed clock, and without `NEBIUS_API_KEY` the removal check is a skip. The whole suite passes with the clock set to 2026-12-05 (528/528);
  - low: removed ids are matched without case;
  - low: the oracle prompt's signature spells a graph parameter as `<name>_n, <name>_edges`;
  - low: Python `async def` now gets the same clear runtime error as JavaScript;
  - low: an answer holding only a closing `</think>` (the trace opened in the prompt) is cut after its last closing tag.
- **UI and tests** (3 low; 33 mutants, 26 killed). axe found 0 violations on 112 states, and 10 keyboard runs were clean. Fixed:
  - the held-Enter guard swallowed every repeated key on Cancel (a held Tab got stuck) and was missing on Attack (a 12 s hold started 4 attacks). Both buttons now ignore only a repeated Enter (`ignoreHeldEnter`, unit-tested);
  - a late clipboard answer after Share wrote an old link back into the address bar once the reader had moved on. A view counter now drops it (an e2e check with a 1.5 s clipboard);
  - test gaps from surviving mutants:
    - `pick()` closing the shared report (e2e on a fresh page);
    - the across-midnight refund (a new guard test that fails without the same-day check);
    - small-scope dedupe on overlapping values;
    - "1 changed line" in the singular.
- Screenshots retaken on the final copy ("hundreds of inputs").
- Checks: lint, typecheck, 532/532 tests, build, and e2e (10 steps).

## Round 14 (2026-10-27, `b67762a`/`985e3d2`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean.
- **Security** (incomplete: the auditor stopped partway, so it is rerun). Its two leads were checked by the main session:
  - low, fixed: if `attack()` ever threw, the route settled the spend at 0 and refunded the whole live reservation ($0.65), though model calls may have cost money. A crash now keeps the reservation charged. `tests/integration/route-crash.test.ts` fails on the old code;
  - low, docs: the 1,000,000-character result budget applies per process (or Judge0 submission), not per attack. The README now says so.
  - Measured: forged records are capped (6 ms for 8 MB), and an 8 MB stdout with no markers takes 150 ms to scan. A full Judge0 attack with 250 K-character results peaked at a 377 ms stall.
- **Security, rerun** (2 medium, 2 low), fixed with tests that fail on the old code:
  - medium: `extractExplanation`'s label patterns let `\s*` cross newlines, so blank lines were quadratic (32,000 took 4.7 s). The patterns now stay within a line, and `stripThinking` is a forward scan;
  - medium: `parseLines` walked every line, so 8 MB of bare newlines per process took 0.14 to 0.6 s (85 s of stalls over one 2,000-input attack). It now jumps between markers (about 1 ms). Fuzzing 200,000 cases against the old version found no difference;
  - low: `codeOnly` was quadratic on unterminated strings (a linear scanner now; 3 × 20 KB worst cases take 5 ms);
  - low: `errorSummary` was quadratic on `a.Error.Error…` (the head of the line only, and `[^:]*`).
  - Clean: sandbox auth, body and output caps, cleanup, the guard, output escaping, diff and toMarkdown.
- **Core** (2 medium, 5 low), fixed with tests:
  - medium: small-scope re-measured shared sub-arrays for each value (a 50×50×50 grid took 4.2 s, three times per attack). Sizes are now memoized in a WeakMap;
  - medium: a run in which the oracle judged 2 of 1,531 inputs was a green "Survived the attack". When most inputs are unjudged, the verdict is now `oracle_unreliable`;
  - low: the shared small-scope budget starved later parameters (4 distinct values instead of 40). Each parameter now gets its own share;
  - low: float mode compared integers from 2^50 exactly, where doubles are 0.25 apart. The exact rule now applies below 2^50 only;
  - low: a JavaScript `async function solve` was judged as returning `{}`. It is now a runtime error that says why;
  - low: `class Solution` methods are unsupported; the README now says so;
  - low: `codeOnly` was quadratic (the same fix as security's).
- **UI and tests** (1 medium, 5 low; 45 mutants, 25 killed by the suite). The UI pass was clean: 20 keyboard runs, 0 axe violations on 108 states, contrast checked, and the races were consistent. Fixed:
  - medium: nothing tested the form-to-request wiring (three `attack-ui` mutants survived). A new e2e step reads the real request bodies, one option at a time, plus "Your own" and the language. The swapped-options mutant now fails it;
  - low: Enter held on Attack cancelled the run, because its repeats hit Cancel. Cancel now ignores repeated keys, and an e2e check fails without that;
  - low: picking a chip with a shared report open dropped the link but kept the banner. Both go now;
  - low: a top-level `oneOf` mutant survived; a unit test now pins its bounds;
  - low: the float tolerance mutant (1e-6 to 1e-5) survived; boundary tests now pin it;
  - low: the trace autoscroll, the trace.jsonl content and the share link in the address bar were untested; the new e2e step checks all three.
- **Judge** (1 high, 2 medium, 1 low; verified by the main session against the Token Factory docs):
  - high: the default fast model `nvidia/nemotron-3-super-120b-a12b` is removed from Token Factory on 2026-11-09, before judging, and requests are not rerouted. Fixed:
    - a `MODEL_REMOVALS` table, and a preflight check "config: model removals" that names the date and the replacement and fails from the date (tests with an injected clock);
    - an owner step in BLOCKED and a box in the SUBMISSION checklist;
    - the default is kept, because it works for the submission and the replacement is unverified;
  - medium: FEEDBACK and FRICTION said no official page lists ids, that JSON mode is undocumented, and that no Nano id exists. All are corrected, with the deprecation-page ids, the json.md `response_format` doc, and the Ultra id still unconfirmed;
  - medium: Token Factory Sandboxes (beta, by request) was not evaluated. FRICTION and FEEDBACK entries now say why and what it would take;
  - low: the checklist test count (now 521).

## Round 13 (2026-10-27, `a3f70e3`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean. The round-12 fixes hold: small-scope is byte-identical to the previous commit on all 39 catalog cases, and no legitimate final record is lost.
- **Security** (1 critical), reproduced and fixed with tests that fail on the old code:
  - code writing straight to stdout (`process.stdout.write` or `os.write`) bypasses the harness's capture and can forge record markers. 2,000,000 empty records (8 MB, under every byte cap) took 32 s to parse, freezing the server for every user (63.7 s end to end against the real sandbox). `parseLines` now stops after the chunk's input count (8 ms), and both executors pass that count.
- **Core** (1 medium, 2 low):
  - medium: a top-level oneOf still built every nested option in full (oneOf 16 of oneOf 16 of arrays of 10,000: 2.2 s and 559 MB; of tuples: 7.6 s). All sequences of one smallScope call now share a 2,000,000-scalar budget (110 and 420 ms of CPU). The catalog's small-scope inputs are byte-identical (52 of 52 cases);
  - low: in float mode two integers compared with a tolerance (1,000,000,000 equalled 1,000,000,001). Two safe integers now compare exactly; larger doubles keep the tolerance, since a float prints as one;
  - low: tuple items over 200 values were cut to a prefix. They are now built to 5,000 and 200 are picked evenly.
- **Bench** regenerated on `a3f70e3`: unchanged, 38/38 found, 0 false alarms. Only the timing-dependent hard-tier timeouts moved, so the README now says 3 of 8 hit the shrink budget.
- **Judge and docs** (1 medium, 3 low; fixed in the docs):
  - medium: SUBMISSION stated the Nebius AI Cloud deploy as done; it is now conditional;
  - low: the Ultra-only median (11.3 s, not 11.2 s);
  - low: the checklist's non-minimal count and test count.
  - The rest was re-verified exactly: a fresh clone gives 511/511, and the replay runs of all 5 built-ins match every quoted figure.
- **UI and tests** (2 low test gaps). The round-12 fixes hold, with races and mutants checked. A fresh pass was clean: 20 keyboard runs, 0 axe violations, 12 error states, 9 malformed links, cancel 4 times, and 505 tests three times under 8 busy loops with no flake. Fixed:
  - Close during a run focusing Cancel had no test. An e2e check now fails on the old code (focus on BODY);
  - `ErrorPage`'s retry plumbing was untested. A test now reads its tree with the effect stubbed, checks that `onRetry` is the boundary's `retry`, and checks that the effect logs the error. The no-op mutant fails it.
- Checks: lint, typecheck, 511/511 tests, build, and e2e (9 steps).

## Round 12 (2026-10-27, `5805541` code, 4 parallel Sonnet audits; findings verified by the main session)

Not clean.
- **Judge and docs** (3 low, fixed in the docs):
  - `docs/screenshots/README.md` gave the old capture date and link length;
  - "thousands of inputs" in README, SUBMISSION and architecture.svg: the inputs per attack are hundreds, and only the sandbox runs reach thousands;
  - the brief lists a root `SUBMISSION.md`, so the root now points to `docs/SUBMISSION.md`.
  - Everything else was re-verified exactly against fresh replay runs: every small-scope count, shrink count, cost and benchmark figure; a fresh clone gives 492/492.
- **Security** (1 high, 1 medium, 1 low). The round-11 fixes hold: 1.5 million fuzzed IPv6 forms found no bypass. All three are reproduced and fixed with tests that fail on the old code:
  - high: a final result line written without a newline skipped the size, total and depth caps (a 7.8 MB result was accepted, with event-loop stalls of 2 to 4 s per input on the local executor and the real sandbox). The final line now gets the same limits, and over them it is dropped like a cut-off line;
  - medium: small-scope built every nested leaf array in full before slicing it. A tuple of 16 one-ofs of 16 arrays took 7.8 s and 556 MB; a oneOf of them ran out of heap at 512 MB. A `limit` now flows into nested values, so the three worst cases take 23, 73 and 421 ms of CPU;
  - low: `extractJson` was quadratic on unclosed braces (60,000 braces: 16 s). After 32 braces that never close it gives up on that text.
- **Core** (3 medium, 1 low). The round-11 fixes hold: 388 random cases give the same minimal result from the old and new shrinker, and the scan budget does not change the hard tier.
  - medium: the shrinker kept every candidate's full JSON in `seen` (1,002 MB peak on a 100,000-value input). It is now keyed by a SHA-1 digest (68 MB on the auditor's script);
  - medium: the same `extractJson` issue as above;
  - medium: a pasted statement with fractional outputs compared "exact" by default, so a correct average computed in another order was flagged. The understand prompt now says when to use "float", and an "exact" spec whose example outputs hold fractions compares as floats, with a trace note;
  - low: an unshrunk counterexample went whole into the explain prompt and the trace messages (170 KB, up to 3.4 MB). Both are clipped now, with the cut marked.
- **UI and tests** (1 medium, 5 low). The browser pass was clean: 20 keyboard runs and 0 axe violations on 44 states. Fixed:
  - medium: my round-11 responsiveness test could not fail, because without the yield no tick ran. It now also needs ticks during the shrink, and the no-yield mutant fails it;
  - low: the CPU-time speed bounds are tightened to about 5× the worst measured under load, so a 10× slowdown fails. Three runs passed, and one run with 8 busy loops passed;
  - low: Close on a shared report during a run focused the disabled Attack button. It now focuses Cancel while running;
  - low: a share-link decode that finished after a run started covered the run. The share reducer now tracks the pending link, and a stale result is dropped (unit-tested);
  - low: two e2e mutation survivors (`pick()` without abort; `run()` without clearing the share hash). A new e2e step covers both, and it fails on the `pick()` mutant;
  - low: the error boundary had no test. Its markup is now a hook-free `ErrorView`, with tests for the alert and for the retry wiring.
- Checks after the fixes: lint, typecheck, 505/505 tests, build, and e2e (9 steps).

## Round 11 (2026-10-26, `f37abc0` = `60c13c4` code, 4 parallel Sonnet audits; findings verified by the main session)

Not clean. All 8 round-10 core fixes were re-checked and hold, with tests.
- **Core** (1 high, 3 medium, 1 low), all reproduced and fixed with tests in `5966c4f`:
  - high: the shrinker took any (int, list of pairs) as a graph, so n = 2^31-1 ran a per-node loop (heap out of memory). It is now a graph only within the node limit and with in-range endpoints;
  - medium: `maxValues` counted a `const` as one value, so an array of a 200-element const ran 43 s. It now counts the contents;
  - medium: small-scope built every layer up to a fixed length (length 200: 11.7 s). It now builds each length directly and bounds the enumerated values (27 ms);
  - medium: a 503 on the generator call ended the attack. It now costs only the model's families, with a warning;
  - low: an explanation cut inside its code block kept the half block.
- **Security** (1 high, 1 medium), fixed with tests in `5966c4f`:
  - high: the same fixed-length small-scope freeze, plus O(N²) synchronous shrink scans over invalid removals. Shrinking now yields to the event loop every 100,000 values scanned, stops at a scan budget, and stops on abort;
  - medium: IPv6 clients could rotate addresses inside their /64 for fresh rate-limit buckets. Limits are now keyed by the /64.
  - The sandbox probes (seccomp, uid, environment, fork churn, auth before body) found nothing.
- **Judge and docs** (3 low): the checklist test count, the FEEDBACK client length, and stale README hard-tier wording and bench output. The bench and soak are being regenerated on the final commit.
- **Deep property run:** `FC_NUM_RUNS=5000` gave 288/288 but 1 unhandled vitest error (`Timeout calling "onTaskUpdate"`). The cause was a synchronous 393 s property; it now yields between cases.
- **UI and tests** (1 medium, 3 low). The browser pass was otherwise clean: all 5 built-ins at 1280, 390 and 320 px; axe-core with 0 violations in light and dark; 12 error scenarios; share links and 13 malformed ones; cancel 6 times in a row; 7 parallel attacks giving 4 × 200 and 3 × 503. Fixed in the next commit:
  - medium: when a run ended, focus jumped from the code editor to the Attack button, so the next Space started a new attack. Focus now moves only from Cancel, `<body>` or nowhere (`focusIsIdle`, unit-tested, plus an e2e step);
  - low: focus fell to `<body>` after toggling the fix view and after closing a shared report. There is now one toggle button that stays mounted, and Close focuses the Attack button. The new e2e step fails on the old code ("got BODY") and passes on the new;
  - low: wall-clock speed bounds in five unit-test files flaked under CPU load. They now measure the worker process's CPU time (`cpuClock`), with the same bounds;
  - low: `ms()` printed "1000 ms" for 999.5 ms and had no boundary test. It now rounds first, and a test covers the boundary.

## Round 10 (2026-10-26, `16d3c2b` = `7204867` code, 4 parallel Sonnet audits; findings verified by the main session)

Not clean.
- **Security:** 3 findings, all reproduced and fixed with tests.
  - High: results under the per-line cap still added up to about 2.3 s of event-loop work per run. A total budget of 1,000,000 characters per run brings it to 0.33 s (`c3a3457`).
  - Medium: deeply nested results overflowed the stack in compare and display. Results deeper than 256 levels are now refused unread, using a linear string-aware scan.
  - High: an infeasible `distinct` array (10,000 elements of a 10-value domain) cost about 45 s of synchronous sampling. Sampling now stops after 100 duplicates in a row; the 50 inputs take under 500 ms.
- **Core** (3 medium, 7 low):
  - medium: an order-dependent counterexample let a no-op fix be "verified"; empty strings and alphabet copies escaped the value accounting; the round-9 reviver prefilter matched every line (the `ms` float digits);
  - low: small-scope stride ran over a truncated product; graph units with no small instances emptied the family; the JS harness `__digits` regex was unanchored; float mode on 309+ digit integers; a truncated-but-nonempty model answer; a replay explanation written for "abba", not "baab".
- **Judge and docs** (3 medium, 6 low):
  - medium: README and VIDEO coin-change numbers are stale after stride sampling; screenshots are stale (old "recorded" badge); the README does not say the hard-tier counterexamples can be non-minimal;
  - low: the soak table has no backing file; replay research labelled "Tavily"; an unmeasured "cheaper and faster" voice-over; the checklist lacks rounds 9-10; load and timing nits; LEASE and pids are tracked.
- **UI and tests:** pending.

## Round 9 (2026-10-26, `8440d3a`, 4 parallel Sonnet audits; findings verified by the main session)

Not clean.
- **Core** (4 medium, 5 low):
  - medium: a stateful solution got an order-dependent counterexample labelled "flaky";
  - medium: the shrinker dropped isolated graph nodes one at a time (the hard-tier counterexample stayed at n=876);
  - medium: `shape: "path"` was missing from the model's DSL doc;
  - medium: `pool` bypassed the value caps (~30 s of synchronous generation);
  - low: 309+ digit integers compared as null; exact integers silently off before Node 21; small-scope cut as a prefix and claimed "every"; a stale fix next to a newer explanation; dead code and replay research wording.
- **Security** (3 confirmed, fixed in `7649452`):
  - high: a huge result line froze the server's event loop. One 10 MB line cost about 12.5 s of CPU; it now costs 8 ms. Lines over 256,000 characters are refused unread, the exact-integer reviver runs only when a 16+ digit run is present, and the output cap is now 8 MB.
  - high: the comparison cost compounded across an attack. This is bounded by the same caps.
  - high: POSIX message queues could outlive a run through `/dev/mqueue`. Every mq_* syscall is now denied, and `/dev/mqueue` is locked and swept. A test fails on the old sandbox, and the container shows 711 with the queue create denied.
- **Judge and docs** (1 high, 7 medium, 8 low):
  - high: replay stand-ins were called "recorded model responses";
  - medium: unverified live claims in SUBMISSION; circular "fixes verified"; non-minimal hard-tier counterexamples; the live max_tokens and finish_reason risk; break-it.md missing; unverified Nebius CLI flags; the svg footnote overlap;
  - low: stale numbers, preflight wording, recorded-fixtures wording, the soak table, replay Tavily wording, stale screenshots, public-repo hygiene.
- **UI and tests** (1 medium, 8 low). Every round-8 item is fixed or partly fixed; axe reports 0 violations across 5 built-ins x 2 widths x 2 themes; `pnpm e2e` passes, including under load.
  - Medium: ReportView rendering is mostly untested; 7 mutations survive.
  - Low:
    - a long executor host widens the page at 390 px;
    - malformed research facts inside an event crash the render;
    - an error line is not treated as terminal;
    - a final partial line reads as a cut;
    - the diff sign contrast;
    - e2e docs and a stale-build check;
    - focus is left on BODY, and the shared banner live region is not always mounted;
    - BIG_RE splices markers inside escaped strings.

## Round 8 (2026-10-25, `0e938c2`, parallel audits on Sonnet; findings verified by the main session before fixing)

Not clean.
- **Agent core and exec** (2 high, 5 medium, 4 low):
  - High: an unreadable generator answer ended the attack before the deterministic families ran.
  - High: the fix and its status were lost when time ran out mid re-attack, and a bad fix paid for the whole re-attack.
  - Medium: hanging inputs on Judge0 cost a whole shared chunk each.
  - Medium: the big-integer marker reached model prompts.
  - Medium: a JS number above 2^53 was compared by its shortest text, not its exact value.
  - Medium: an entry function that is not in the code gave a misleading compile error.
  - Medium: a cancel during research was swallowed.
  - Low: the no-bug message did not mention dropped flaky mismatches; the "did not reproduce" label was wrong; a crash in a shared chunk was blamed without a solo re-run; dead code (`Tracer.jsonl`, `stage_end`, file-local exports).
- **UI and tests** (3 medium, 7 low, plus test gaps):
  - Medium: an error response with an empty statusText showed nothing; big-integer args showed the internal marker; malformed but well-typed stream lines crashed the page.
  - Low: 390 px overflow from long unbreakable text; a raw "network error" on reset; stale ReportView state across share links; the diff unreadable to screen readers; notes not in an always-mounted live region; a stalled stream after the report.
  - Test gaps: no browser smoke test; untested branches (null body, fixSummary branches, the shrink-exhausted heading, fatal UTF-8, route unpriced charging); order-dependent e2e tests; live-wiring timeouts leaking env under heavy load.

## Round 7 (2026-10-25, `91aa3f5`, four parallel full audits)

Not clean: 0 critical, 2 high, 11 medium, 13 low. The security audit found nothing exploitable; the other three found the rest. Fixed in `915880a` with tests, except the UI items, which are being finished:
- **Judge view.**
  - High: the "no model generators" ablation also dropped small-scope, which overstated Nemotron's role. There is now a separate no-model ablation, a "Found by family" column, and honest README text: the deterministic families alone find 30/30.
  - High: the checklist cited break-it.md before it existed.
  - Medium: architecture.svg said no model output runs.
  - Medium: replay demos hit 429 after 10 attacks per hour; replay now has its own limit, REPLAY_RATE_LIMIT_PER_HOUR=120.
  - Medium: VIDEO.md described a demo that no longer happens; it is now coin-change.
  - Low: the timing label; stale screenshots.
- **Core.**
  - Medium: big-integer example outputs; JS BigInt results; the JS harness on Node 12 (perf_hooks); per-input limit on Judge0 finished chunks; fix verified with no judged inputs; confirmHits dropping real bugs.
  - Low: the run reserve was doubled; the big-integer marker leaked into JSON; a dead shrink candidate; float mode inside objects.
- **UI and tests.**
  - Medium: the run state machine was untested; a flaky sandbox queue test.
  - Low: malformed stream lines; share errors below the fold; clipboard rejections; cancel note not visible; scrollable regions not focusable; a weak Semaphore test.

## Round 6 (2026-10-25, `04f1f92`, four parallel full audits: agent core, security, judge view and docs truth, UI/tests/scalability)

Found 37 (5 high, 18 medium, 14 low; no critical), plus a false alarm seen in a benchmark run against the sandbox container. All are fixed with regression tests in `3b0bf80`, `5d4f6c6` and `99ed3a2`, so the clean-audit count stays at 0. The full list is under "Round 6" in WIN-CHECKLIST.md. The highs:
1. An unconfirmed (spurious) mismatch was claimed as a bug. Under load, a correct binary search was reported broken against the Judge0-compatible sandbox.
2. Correct code returning an object with its keys in a different order was flagged.
3. A solution's output was never size-limited: 4 MB reached the stream, the DOM and the explain prompt.
4. Submitted code had outbound network access from the sandbox.
5. The checklist cited break-it.md before it existed.

## Round 4b (2026-10-24, working tree before the gate kit commit)

Found 10, all fixed before this commit, so the clean-audit count stays at 0:

1. A bitwise-risk regex matched `|| 0`.
2. Edited demo code in another language replayed a wrong-language fix.
3. Small-scope graph enumeration was unbounded for large `n`.
4. One failed research question aborted the others.
5. The stage reasons listed APIs dropped by the cap.
6. Auto mode researched code patterns, against the brief.
7. Small-scope ignored the per-family budget; the mutation family did too, which the new test caught.
8. The README soak numbers predated the code, and `--readme` wrote even on a failing run.
9. The diff was not memoised.
10. A CRLF diff showed every line as changed.

Next: two consecutive full audits that find nothing, each recorded here with its commit.
