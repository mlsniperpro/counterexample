# HANDOFF (COUNTEREXAMPLE)

Written 2026-10-24 ~23:00 UTC by session_01UsWurhxjKnsfg5iDpVasE9 for a successor that has only this repo.

## Goal, deadline, PR
- Goal: WIN the Nebius x NVIDIA hackathon with Counterexample. "Done" means `bash .agent/win-gate.sh COUNTEREXAMPLE` prints `GATE: PASS` on the pushed HEAD after the last code change, followed by a final status comment on PR #1 (mlsniperpro/counterexample, branch `counterexample` -> `main`). Otherwise: post the final status after the deadline.
- Deadline (code freeze): 2026-10-29T15:00Z (Thu 18:00 EAT).
- Rules:
  - Follow BRIEF.md and AGENTS.md: pnpm only; never commit secrets; log sponsor-tool problems in docs/FRICTION.md.
  - One PR only, and don't touch other PRs or issues.
  - Push at most once per 45 min, and squash WIP before pushing.
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
