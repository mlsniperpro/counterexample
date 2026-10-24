# WIN checklist: Counterexample (Nebius x NVIDIA Global AI Hackathon)

Freeze: **Thu 2026-10-29 18:00 EAT (15:00 UTC)**. Every row points at evidence in this repo. Green = done and verified in this repo; amber = built and tested, but its final proof needs an owner input listed in `BLOCKED.md`; red = not done.

Last full audit: 2026-10-24 (round 4).

## Judging criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Built well + uses Token Factory and Nemotron | amber | Typed, budgeted stages (`src/lib/agent/`); Ultra for oracle and explanation, Super for generators and research, per-step routing panel. The live path is proven over real HTTP against fake Token Factory and Tavily servers plus the real sandbox (`tests/integration/live-wiring.test.ts`: full attack, retry after a 429, a custom statement through the API). `pnpm preflight` is ready. **Real Token Factory run pending keys.** |
| Creativity | green | Brute-force oracle that must pass the examples before any bug is claimed (after ALGO); model-written generators as a safe DSL; EvalPlus-style mutation; delta debugging over structured inputs; fixes re-attacked before they are called fixed; reports shared by link without a server. |
| Design (UX) | green | One click to a minimal counterexample in replay mode; live trace; "Why Ultra here, Super there" panel; share link; 390 px screenshots (`docs/screenshots/`); no horizontal scroll, no console errors (`pnpm screenshots` output in `docs/screenshots/README.md`). |
| Potential impact | green | Interview prep plus reviewing AI-written code. Benchmark: 30/30 bugs, 0/10 false alarms. Soak: every non-equivalent mutant of the reference solutions killed, 0 unsound claims (`bench/results/soak.md`). |
| Best use of Tavily (bonus) | amber | Research runs when the statement cites sources or the user ticks **Research the web**; facts are cited, and families may cite only facts from this run's research. Replay fixtures are checked against their sources. **Real Tavily run pending key.** |

## Brief requirements

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Scaffold: Next.js, pnpm, MIT, README | green | `package.json`, `LICENSE`, `README.md` |
| 2 | Token Factory client, env ids, replay provider | green | `src/lib/models/nebius.ts`, `replay.ts`; `tests/integration/providers.test.ts`, `live-wiring.test.ts` |
| 3 | Judge0 executor | green | `src/lib/exec/judge0.ts`; `tests/integration/executors.test.ts`, `sandbox.test.ts` |
| 3 | Local executor (dev only, labelled) | green | `src/lib/exec/local.ts`; production refuses it (`tests/integration/providers.test.ts`) |
| 3 P1 | Nebius AI Cloud executor | amber | Own sandbox (`sandbox/`) deployable as a Nebius Serverless endpoint (`docs/NEBIUS-SANDBOX.md`); Docker build + preflight + benchmark verified locally. **Deployment pending AI Cloud credentials.** |
| 4 | Typed stages, budgets, trace.jsonl streamed | green | `src/lib/agent/stages.ts`, `budget.ts`, `trace.ts`; `tests/unit/budget-trace.test.ts`, `tests/integration/api.test.ts` |
| 5 | Shrinker, unit-tested | green | `src/lib/core/shrink.ts`; `tests/unit/shrink.test.ts` (property tests incl. local minimality) |
| 6 | Tavily research when external or asked, cited, shows effect on generators | green | `researchStage`; toggle; `tests/e2e/agent-replay.test.ts` (all built-ins with `force`) |
| 7 | UI: paste or pick 5 classics, live trace, counterexample, fix, re-attack, phone width | green | `src/app/*`; `docs/screenshots/` |
| 8 | Benchmark: 30 buggy + 10 correct, bug-found rate, time to first counterexample, false alarms, cost Ultra-only vs routed | green (fixture) / amber (live) | `bench/run.ts`, `bench/results/fixture.md`; live numbers need keys |
| 9 | Deploy, IP rate limit, daily spend cap | amber | Guards done and tested (`tests/unit/guard-limit.test.ts`); **Vercel env pending owner** |
| 10 | FEEDBACK, FRICTION, VIDEO, SUBMISSION, architecture.svg | green | `docs/`, `SUBMISSION.md` |
| Done | Replay end to end in tests; live marked owner-to-verify | green | `tests/e2e/agent-replay.test.ts`; `BLOCKED.md` |

## Quality bar

| Item | Status | Evidence |
| --- | --- | --- |
| Lint 0 warnings, strict TS, tests green | green | PR body: pasted `pnpm lint && pnpm typecheck && pnpm test` output |
| Property tests at high counts | green | `FC_NUM_RUNS=…` long runs (PR body) |
| Soak / failure injection | green | `pnpm soak` (`bench/results/soak*.md`); fake 429s; aborts; timeouts |
| Fresh-clone README run | see PR | Fresh clone, `pnpm install`, `pnpm test`, `pnpm bench` (PR body) |
| Security review | green | PR Self-review; sandbox env and auth tests |

## Open items (next rounds)

- Real Token Factory, Tavily and Judge0/Nebius runs: owner inputs (`BLOCKED.md`). `pnpm preflight` then `pnpm bench --live --readme`.
- Raise the bar once all rows are green: judge's first five minutes, demo polish, Tavily depth.
