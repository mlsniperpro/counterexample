# HANDOFF (COUNTEREXAMPLE)

Updated 2026-10-25 ~13:20 UTC by session_01Q1oMvNAnBQBDukXyvqyhQZ. The owner said RESUME after the wind-down; the lease is active again.

RESUMED 2026-10-26 18:53 UTC (the owner cancelled the 18:52 wind-down; the lease is active). The round-10 core WIP is green as committed (lint, typecheck, 482/482 tests). A Sonnet finisher is checking it item by item and writing the missing finding-1 tests. The round-10 UI audit is rerunning on `6ce18b2`.

WIND DOWN (2026-10-26 ~18:45 UTC, owner request; the owner resumes this session after the usage reset). The lease is released.
- Pushed and green:
  - rounds 6 to 9;
  - round 10 security: `c3a3457` (total result budget per run), `83fe9d6` (nesting depth 256, distinct early stop);
  - round 10 docs: `6ce18b2`.
- In flight, committed as UNVERIFIED WIP in this handoff commit: the round-10 core fixes (Sonnet fixer stopped mid-way, while writing the finding-1 tests).
  - Files changed at stop: src/fixtures/replay.ts src/lib/agent/model-call.ts src/lib/agent/parse.ts src/lib/agent/stages.ts src/lib/agent/types.ts src/lib/core/compare.ts src/lib/core/smallscope.ts src/lib/core/spec.ts src/lib/exec/program.ts src/lib/models/nebius.ts src/lib/models/types.ts src/lib/share.ts tests/e2e/agent-replay.test.ts tests/integration/agent-failures.test.ts tests/integration/confirm-shrink.test.ts tests/integration/executors.test.ts tests/integration/providers.test.ts tests/unit/compare.test.ts tests/unit/model-call.test.ts tests/unit/program.test.ts tests/unit/share.test.ts tests/unit/smallscope.test.ts tests/unit/spec.test.ts 
  - The findings it was fixing are under "Round 10 → Core" in reaudit.md:
    1. order-dependent re-attack replaying the failing sequence;
    2. value accounting `Math.max(1, …)` and the alphabet copy;
    3. BIG_DIGITS prefilter on the out part only, and rounded ms;
    4. small-scope mixed-radix stride over the full product;
    5. empty graph unit;
    6. JS `__digits` regex anchoring;
    7. floatEq on big markers;
    8. finishReason "length" with some text;
    9. the "baab" replay explanation.
  - FIRST: run `pnpm lint && pnpm typecheck && pnpm test`. Then check each of the 9 items against the code, finish the missing ones (finding 1's tests were not written yet), and get it green.
- Round-10 UI/tests audit: stopped before reporting, so it has no findings. Rerun it.
- Next steps, in order:
  1. Make the core WIP green and complete.
  2. Rerun the round-10 UI audit.
  3. Run full audit rounds until 2 in a row are clean.
  4. Gather the evidence on the final HEAD: `pnpm bench --readme`, `pnpm soak --all --seeds 3 -j 2 --readme`, FC_NUM_RUNS=5000 unit tests, the sandbox bench quiet and under load, a fresh clone, `pnpm build && pnpm e2e`, axe-core, and `pnpm screenshots` (the screenshots are stale).
  5. Write break-it.md and reaudit.md headers.
  6. Run the gate.
  7. Update the PR body and post the final status comment.

RESUMED 2026-10-26 18:02 UTC (lease active). Running on `16d3c2b`, the same code as `7204867`: audit round 10 (4 Sonnet auditors) and a soak (all 54 solutions, 3 seeds) in a scratch worktree.

WIND DOWN (2026-10-26 ~17:15 UTC, owner request). The lease is released and the work moves to a fresh session.
- Pushed and green on `7204867` and its handoff follow-ups: rounds 6 to 9 are fully fixed.
  - Checks: lint clean, typecheck clean, 435/435 tests, `pnpm build`, and `pnpm e2e` (7 browser checks) all pass.
  - Bench regenerated: 38/38 found, 0 false alarms; the hard tier finds 8/8 routed against 0/8 for both ablations.
  - Soak on the pre-round-9 code: 1509 attacks, 0 unsound, 0 missed.
- Stopped with no results:
  - The round-10 audits (4 Sonnet auditors on `7204867`). The security auditor had confirmed all syscall denials before it was stopped. No findings are recorded.
  - The soak rerun on `7204867`, killed early.
- Next steps, in order:
  1. Claim the lease.
  2. Run audit round 10 with 4 parallel Sonnet auditors (core, security, judge/docs, UI/tests) on HEAD. Verify each finding, then fix it.
  3. Repeat the audits until 2 consecutive rounds are clean.
  4. On the final HEAD, gather the evidence:
     - `pnpm bench --readme`;
     - `pnpm soak --all --seeds 3 -j 2 --readme` (about 70 minutes);
     - `FC_NUM_RUNS=5000 pnpm exec vitest run tests/unit --testTimeout 3600000`;
     - the sandbox bench, quiet and under load: rebuild the image with `DOCKER_BUILDKIT=0 docker build -t counterexample-sandbox sandbox/` (start `dockerd` first), then `docker run -d -p 2358:2358 -e SANDBOX_TOKEN=x --read-only --tmpfs /tmp:size=64m --tmpfs /dev/shm:size=1m counterexample-sandbox` and `JUDGE0_URL=http://localhost:2358 JUDGE0_TOKEN=x pnpm bench --only binary-search`;
     - a fresh-clone README run;
     - `pnpm build && pnpm e2e`;
     - axe-core.
  5. Write break-it.md (TESTED_COMMIT = HEAD) and reaudit.md (AUDITED_COMMIT = HEAD, CLEAN_AUDITS_IN_A_ROW = 2, OPEN_CRITICAL and OPEN_HIGH = 0).
  6. Run `bash .agent/win-gate.sh COUNTEREXAMPLE` and push.
  7. Rewrite the PR #1 body; it is stale (old benchmark table, P1 "not built", no rounds 4 to 9). Post the final status comment.

STATE 2026-10-26 ~17:10 UTC: round 9 is fully fixed in this push.
- Security: `7649452`.
- Core, judge and UI: this commit. It adds order-dependent counterexamples for stateful solutions, bulk graph shrinking (dag n 876 → 215/460), honest replay wording, 16k/8k max_tokens with finish_reason handling, the guard reservation at 16,384 tokens, and more.
- Checks: lint, typecheck, 435/435 tests, build, and `pnpm e2e` (all 7 checks) are green. The bench was regenerated: 38/38 found, 0 false alarms; the hard tier is 8/8 against 0/8 for both ablations.
- Soak of all 54 solutions at 3 seeds, on the pre-round-9 code: 1509 attacks on 503 mutants, 1437 killed, 0 unsound, 0 missed, 72 survived, 0 errors. A rerun on `7204867` is in progress; rerun it on the final commit for break-it.md.
- Audit round 10 (4 Sonnet auditors) on `7204867` is in progress.
- Next: audit round 10 (4 Sonnet auditors) on this HEAD; then repeat until 2 clean rounds in a row, then the evidence, break-it.md, the gate, the PR body and the final comment.

RESUMED 2026-10-26 15:48 UTC by session_01Q1oMvNAnBQBDukXyvqyhQZ (lease active). The round-8 UI/test WIP below is now VERIFIED green on `8440d3a`: lint (0 warnings), typecheck clean, `pnpm test` 381/381, `pnpm build`, and `pnpm e2e` (7 browser checks passed). Round 9 (4 parallel Sonnet audits on `8440d3a`: core, security, judge/docs, UI/tests) is in flight; the UI audit also checks each round-8 UI finding.

WIND DOWN (2026-10-25 ~14:20 UTC, owner request): the lease is released; the work moves to a fresh session.
- Pushed and green:
  - all of rounds 6-7;
  - round 8 core fixes, `def52a7`;
  - the HARD benchmark tier, `a74fb68` (routed 8/8, both ablations 0/8; overall 38/38 found, 0 false alarms);
  - the SUBMISSION results.
- In flight, committed as WIP in this handoff commit, NOT verified: the round-8 UI/test fixes by a stopped Sonnet subagent. Files:
  - src/app/{attack-run,attack-ui,format,report-view,run-state,stream}.ts(x), src/app/globals.css, new src/app/error.tsx;
  - tests/unit/{attack-run,run-state,share,stream,format,report-view}.test.ts, tests/app-fixtures.ts;
  - tests/e2e/agent-replay.test.ts, tests/integration/live-wiring.test.ts;
  - new scripts/e2e-smoke.mjs, package.json (an `e2e` script), .agent/win/COUNTEREXAMPLE/checks.sh (adds `pnpm e2e`).
  
  FIRST: run `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`. A typecheck error was seen earlier in tests/unit/report-view.test.ts:29 ("'shown' is possibly 'undefined'"). Then check each of the round-8 UI findings in reaudit.md ("Round 8 … UI and tests") against the code, finish what is missing, and fix until green.
- Round 9 audits (core, security, judge) were started on `c16be41` and stopped before reporting: there are no findings to carry over. Rerun them.
- Next, in order:
  1. Make the UI WIP green and complete.
  2. Run a full audit round with 4 parallel Sonnet auditors (core, security, judge/docs, UI/tests); verify each finding, then fix it.
  3. Repeat until 2 consecutive clean rounds.
  4. Evidence on the final HEAD:
     - `pnpm bench --readme`;
     - `pnpm soak --all --seeds 3 -j 2 --readme`;
     - `FC_NUM_RUNS=5000 pnpm exec vitest run tests/unit --testTimeout 3600000`;
     - the sandbox bench (`docker run … counterexample-sandbox`, then `JUDGE0_URL=http://localhost:2358 JUDGE0_TOKEN=x pnpm bench --only binary-search`), quiet and under load;
     - a fresh clone;
     - axe-core.
  5. Write break-it.md (TESTED_COMMIT) and reaudit.md (AUDITED_COMMIT, CLEAN_AUDITS_IN_A_ROW=2).
  6. Run the gate and push.
  7. Rewrite the PR #1 body (it is stale: old benchmark table, P1 "not built", no rounds 4-8) and post the final status comment.
- Evidence gathered on older commits (re-run on the final one):
  - the soak on `8155b4b`: 1017 killed, 0 unsound, 0 missed, 54 survived;
  - the 1-seed soak with the hard tier: 479 killed, 0 unsound, 0 missed;
  - `FC_NUM_RUNS=5000` unit tests: 183/183;
  - the JS harness under a real Node v12.14.0: BigInt digits OK;
  - the sandbox bench: 12/12, quiet and under load.

## Latest state (read first)
- Round 6 is fully fixed and pushed. Commits: `3b0bf80` core, `5d4f6c6` UI and docs, `99ed3a2` security, `a0f7d69` bench results, `91aa3f5` handoff. The sandbox is hardened with a seccomp network deny, per-run memory and file limits and locked dirs. `/health` shows network blocked.
- Round 7 (four audits of `91aa3f5`) is NOT clean:
  - Security audit: no findings.
  - Core audit: 6 medium, 4 low. All fixed in the WIND DOWN commit, with tests:
    - big-int example outputs are kept exact;
    - JS BigInt results are written as exact digits;
    - the JS harness uses perf_hooks, for Judge0 Node 12;
    - Judge0 enforces the per-input limit on finished chunks, after a solo re-run;
    - a fix is verified only if the counterexample itself was judged, with unjudged inputs reported;
    - confirmHits loops through batches;
    - the run reserve is right-sized;
    - the big-int marker no longer leaks into JSON (showValue at the JSON boundaries, exactReviver in stream.ts);
    - the dead shrink candidate is removed;
    - float mode recurses into objects.
  - Judge audit, fixed:
    - a new "no-model" ablation, plus a "Found by family" column and row;
    - the README ablation text rewritten honestly (deterministic families alone find 30/30);
    - the architecture.svg claim;
    - a separate replay rate limit, REPLAY_RATE_LIMIT_PER_HOUR=120;
    - VIDEO.md now demos coin-change;
    - the TTFC label.
  - Judge audit, open: rerun `pnpm screenshots` on HEAD (the screenshots are stale), and write break-it.md, which the checklist cites but which does not exist.
  - UI audit: 2 medium and 5 low, IN PROGRESS when wind-down hit. A stopped agent left partial edits, which are committed in the WIND DOWN commit: `src/app/run-state.ts`, `src/app/clipboard.ts`, their tests, and edits to attack-ui.tsx, stream.ts, report-view.tsx, globals.css, sandbox.test.ts and guard-limit.test.ts. They typecheck, lint clean and pass `pnpm test` (314/314 after one assertion update), but have not been reviewed or browser-checked. Re-verify each finding:
    1. extract the run state machine into a pure tested module (run-state.ts may be partial); mutations like `live = () => true` must fail a test;
    2. sandbox.test "queue is full" is flaky under heavy load: poll /health until active===1 instead of setTimeout(100);
    3. a malformed stream line must abort the run's controller, cancel the reader, and show "The server sent an unreadable response.";
    4. a share-link decode error must render at the top, not below the fold;
    5. a clipboard failure needs try/catch and a visible note;
    6. a cancelled run needs a visible muted note;
    7. the live-trace `<ol>` and the diff `<pre>` need tabIndex=0, role=region and aria-label (axe scrollable-region-focusable);
    8. the Semaphore test needs an A-runs, B-queues, C-arrives-after-A-finishes case.
- Planned next (task): a HARD benchmark tier, with 8+ bugs that only worst-case-size or structured inputs expose (first-pivot quicksort on large sorted input, recursion on long chains, and so on). Model families must be needed there, and the no-model ablation must miss them. Not started (that agent was stopped before changing anything). This is the strongest "use of Nemotron" evidence we lack.
- Then:
  1. audit round 8 (4 parallel audits);
  2. fix and repeat until 2 clean rounds in a row;
  3. on the final HEAD: soak, `FC_NUM_RUNS=5000` units, the sandbox bench (also under load), a fresh-clone run;
  4. write break-it.md and reaudit.md (AUDITED_COMMIT = the final HEAD);
  5. run the gate, push, and post the PR #1 status comment.
- Push rule (owner, replaces the old 45-minute spacing): Push when a substantial task is complete and green (a set of findings fixed and tested, a feature slice working, a soak or break-it pass recorded, a gate run); no timer. Every push is a meaningful, squashed commit set: never empty, format-only or "wip" commits; exactly one PR (#1). PR #1: subscribing to activity failed, so check it manually.
- Container: `docker run -d -p 2358:2358 -e SANDBOX_TOKEN=x --read-only --tmpfs /tmp:size=64m --tmpfs /dev/shm:size=1m counterexample-sandbox`. Start `dockerd` first, then `DOCKER_BUILDKIT=0 docker build -t counterexample-sandbox sandbox/`.

## Earlier hand-off (2026-10-24, previous session)
Written 2026-10-24 ~23:00 UTC by session_01UsWurhxjKnsfg5iDpVasE9 for a successor that has only this repo.

## Goal, deadline, PR
- Goal: WIN the Nebius x NVIDIA hackathon with Counterexample. "Done" means `bash .agent/win-gate.sh COUNTEREXAMPLE` prints `GATE: PASS` on the pushed HEAD after the last code change, followed by a final status comment on PR #1 (mlsniperpro/counterexample, branch `counterexample` -> `main`). Otherwise: post the final status after the deadline.
- Deadline (code freeze): 2026-10-29T15:00Z (Thu 18:00 EAT).
- Rules:
  - Follow BRIEF.md and AGENTS.md: pnpm only; never commit secrets; log sponsor-tool problems in docs/FRICTION.md.
  - One PR only, and don't touch other PRs or issues.
  - (Superseded by the owner's push rule in "Commands": push when a substantial task is complete and green, no timer.)
  - Run `pnpm lint && pnpm typecheck && pnpm test` before every push.
  - Never edit `.agent/win-gate.sh`, tests or thresholds to get green.

## Done (with evidence)
- **Agent:**
  - Ultra writes the brute-force oracle, which must match the examples.
  - Super writes generator families in a typed DSL that is interpreted and never executed.
  - Small-scope exhaustive inputs, EvalPlus-style mutations and a random baseline.
  - Sandboxed runs, a ddmin shrinker, explain, fix, re-attack.
  - Tavily research for API-doc risks and cited statements.
  - UI with share links in the URL fragment.
  - Guards: per-IP limits, a daily spend cap, concurrency leases.
  - Code is in `src/lib/agent/` and `src/lib/`; the UI is in `src/app/`.
- **Executors:**
  - Replay provider (deterministic).
  - Local executor (dev only).
  - Judge0 executor.
  - Own Judge0-compatible sandbox (`sandbox/`): can run as a Nebius Serverless AI endpoint (`docs/NEBIUS-SANDBOX.md`), with per-slot uid isolation, process cap, kill-all after each run, and tini.
- **Round 5 hostile audit:** 14 findings, all fixed in `f8c7352` with regression tests (list under "Round 5" in WIN-CHECKLIST.md).
- **Evidence on the round-5 code `f8c7352`** (results committed in `7055259`):
  - `pnpm bench --readme` (`bench/results/fixture.{json,md}`, README benchmark section): 30/30 bugs found, 0 false alarms, 30/30 fixes verified, 0 errors. Ablation without model generators: 27/30.
  - `pnpm soak --all --seeds 3 -j 3 --readme` (`bench/results/soak-all.{json,md}`): 1071 attacks, 1017 killed, 0 unsound, 0 missed, 54 survived (likely equivalent mutants), 0 errors.
  - `FC_NUM_RUNS=5000 pnpm exec vitest run tests/unit --testTimeout 3600000`: 134/134 passed.
  - `pnpm test`: 241/241; `pnpm lint` 0 warnings; `pnpm typecheck` clean; `ruff check bench/solutions` clean.
  - Docker sandbox (`DOCKER_BUILDKIT=0 docker build -t counterexample-sandbox sandbox/`; Docker Hub rate-limits BuildKit metadata lookups):
    - an escaping forked child (setsid) plus an infinite loop gives TLE at about 1.2 s;
    - `/proc/<ppid>/environ` and `/proc/1/environ` are denied;
    - a fork bomb stops at 63 processes;
    - no process is left after a run.
  - Preflight against the container passed `config: sandbox`, `judge0: languages` and `judge0: run`.

## In flight (stopped, not committed)
- The `pnpm bench --only binary-search` run against the container was stopped before it finished. No result exists for it. The pre-round-5 run gave 12/12 expected verdicts.
- Audit round 6 (a subagent) was stopped before reporting. No findings are recorded.
- `.agent/win/COUNTEREXAMPLE/break-it.md` was never written. `reaudit.md` still says `AUDITED_COMMIT: PENDING`, `CLEAN_AUDITS_IN_A_ROW: 0`.

## Next steps (in order)
1. `pnpm install`, then `bash .agent/win-gate.sh COUNTEREXAMPLE` to see the current failures.
2. Re-run `pnpm bench --only binary-search` against the sandbox container:
   - `docker run -d -p 2358:2358 -e SANDBOX_TOKEN=x --read-only --tmpfs /tmp counterexample-sandbox`
   - then `JUDGE0_URL=http://localhost:2358 JUDGE0_TOKEN=x pnpm bench --only binary-search`.
3. Do a fresh-clone README run: clone, then `pnpm install`, `pnpm test`, `pnpm build`.
4. Write `break-it.md`: `TESTED_COMMIT: <HEAD sha>`, then the evidence above plus steps 2 and 3. Commit only .md/.agent files after that commit; any other file change invalidates it.
5. Run full hostile audits of the whole entry on HEAD and record them in `reaudit.md` (header lines `AUDITED_COMMIT`, `OPEN_CRITICAL`, `OPEN_HIGH`, `CLEAN_AUDITS_IN_A_ROW`). You need 2 consecutive audits that find nothing. Any code fix resets the count, and evidence must then be re-run on the new HEAD.
6. Run the gate until it passes, put its last line in the PR body, then post the final status comment on PR #1.

## Open audit findings
- None known. Round 5 is fully fixed. Round 6 was not completed.

## Key decisions (why)
- The model writes a typed input DSL, interpreted and never executed: safe, and bounded by SPEC_LIMITS.
- P1 is a Serverless AI endpoint, not Jobs: Jobs have no REST logs endpoint (docs/FRICTION.md).
- The sandbox server runs as root in the container only to switch each run to its slot's unprivileged uid; this gives isolation without nsjail.
- Unmetered or failed live calls count as unpriced, so the spend cap is conservative.
- Forwarding headers are trusted only on Vercel or with `TRUST_PROXY_HEADERS=1`.
- Everything else is in the PR "Decisions" section.

## Commands
- Owner rule (2026-10-25, keep across hand-offs), replacing the 45-minute push spacing everywhere (brief, this file, earlier messages): Push when a substantial task is complete and green (a set of findings fixed and tested, a feature slice working, a soak or break-it pass recorded, a gate run); no timer. Every push is a meaningful, squashed commit set: never empty, format-only or "wip" commits; exactly one PR (#1). Never sit idle and never end the turn to wait: while a subagent, audit, soak or build runs, keep working on the next item here and collect results when they arrive. Never stop with "will push at HH:MM" or "waiting for X". The only two reasons to stop are the API usage limit or the /goal being met.
- Owner rule (2026-10-25, keep across hand-offs): every subagent launched with the Agent tool uses model "sonnet" and effort "high". That covers auditors, reviewers, fixers, researchers and soak/log watchers. The main session keeps integration, self-review of the diff, deciding which findings are real (verify each Sonnet finding before fixing it, and never drop one unchecked), and the gate.
- Install: `pnpm install`
- Test: `pnpm lint && pnpm typecheck && pnpm test`
- Run (replay, no keys): `pnpm dev`
- Benchmark: `pnpm bench`, `pnpm soak --all --seeds 3 -j 3 --readme`
- Gate: `bash .agent/win-gate.sh COUNTEREXAMPLE` (its checks are in `.agent/win/COUNTEREXAMPLE/checks.sh`)
- Playwright needs `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` in the original container.

## Owner-only blockers (BLOCKED.md)
- NEBIUS_API_KEY and TAVILY_API_KEY, for the live path and `pnpm bench --live`.
- Nebius AI Cloud credentials, to deploy the sandbox endpoint.
- The Vercel project and environment variables.
- Demo video footage.
- Making the repo public.
