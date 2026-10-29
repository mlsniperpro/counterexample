# break-it.md (COUNTEREXAMPLE)

TESTED_COMMIT: d5e09fa

What was done to try to break this entry, and the results. This is the attacker's-eye record that complements reaudit.md (the round-by-round audit log). All work is on commit `d5e09fa` unless noted; the timings come from a cloud container shared with up to four parallel audit subagents, so wall-clock figures are inflated.

## Adversarial testing performed

- **34 rounds of hostile audit** (reaudit.md), each four parallel Sonnet reviewers at high effort over core, security, UI/tests and judge/docs, plus main-session verification of every finding. More than 260 issues were found and fixed or recorded; the last rounds found only borderline, test-gap or hardening items, listed in reaudit.md. Two findings from round 34 are open (see below).
- **Property testing at scale.** `FC_NUM_RUNS=5000` over the unit suite: all 378 property tests pass (the process exit is 1 only from a vitest-worker `onTaskUpdate` timeout under heavy concurrent load, not a test failure). `FC_NUM_RUNS=1000` is part of `checks.sh` and passes.
- **Differential parser fuzzing.** `parseExact` vs `JSON.parse(text, exactReviver)` over hundreds of thousands of random and adversarial JSON texts (big integers, escaped quotes, marker look-alikes, odd whitespace, numbers in key position): no divergence in value or in accept/reject.
- **Full benchmark**, every round, in four configurations (routed, Ultra-only, no-model, random-only): verdicts, costs and the load line are stable and match `bench/results/fixture.md` (only timings and hard-tier minimal strings vary, as documented).
- **Soak** (`pnpm soak --all --seeds 3 -j 2`, a fresh clone of `d5e09fa`): mutation testing of all 54 benchmark solutions across 3 seeds; reached 850 of 1509 attacks with 0 unsound before that background run hit its time limit; a prior full run is recorded in `bench/results/soak-all.md`. Earlier full soak runs (recorded in `bench/results/soak-all.md`: 503 attacks) found 0 unsound and 0 missed.
- **Fresh-clone build.** A clean `git clone` of `d5e09fa` + `pnpm install --frozen-lockfile` installs and builds from the lockfile with no error.
- **Sandbox escape and resource attacks**, against the image built from `sandbox/Dockerfile` with the documented hardened flags: network (every address family) denied; namespaces, mounts, chroot, SysV/POSIX IPC, io_uring, `memfd_create`, `socketpair`, `inotify` and the legacy AIO calls denied; `fork`/`vfork`/non-thread `clone` denied so a run is a single process bounded by one `RLIMIT_AS` (threads and `worker_threads` still work); `ulimit -c 0`; per-run memory, CPU, output (8 MB), file-size, open-file and process limits enforced; shared temp dirs locked; no secret or server environment reachable. Memory attacks (buffer bombs, fork bursts, pipe/pty/inotify kernel-memory) are all bounded; cross-run OOM harm was the round-32 medium, fixed by the fork denial.
- **UI hostile inputs.** Crafted share links at every schema cap (huge numbers, deep nesting, bidi/zero-width/HTML text, `javascript:`/`data:` URLs, 9,000-line diffs) render without script execution, horizontal overflow or axe violations; `javascript:`/`data:` URLs are rejected. axe (wcag2a/aa, wcag21a/aa, wcag22aa, best-practice) is clean across every report state at 320/390/1280 px in light and dark.
- **Secrets.** `git log -p --all` over the full history: no keys, tokens or committed `.env`; only placeholders.

## Round-34 findings: fixed

Two round-34 wrong-verdict risks in the hard-tier hang-detection feature were found and **fixed** (commit `0d4def7`, tests in `tests/integration/agent-failures.test.ts`):

1. **A family whose inputs all time out** no longer exhausts the wall clock before the hit is reported. The run stage used to judge a 64-input window in full (64 x the time limit) before examining hits; it now judges each window in doubling sub-batches (4, 8, 16, 32, 64). Fast inputs still run the whole window, so the smallest hit across it is chosen and the built-in demos are byte-for-byte unchanged, but a sub-batch that all times out is confirmed at once. Verified: a correct-but-hangs-when-long solution against an all-long family is reported as a timeout counterexample after a handful of inputs.
2. **A brute-force oracle too slow on one large family** no longer stalls the attack: once the oracle fails on an opening sub-batch with nothing judged, the family is skipped with a trace warning and later families run. Verified: a correct solution against an exponential oracle on a 22-to-24-element family gets an honest verdict within budget.

A full `pnpm bench --readme` on the fix leaves the verdicts, costs and the load line unchanged; only the median times and hard-tier minimal strings move, within the documented run-to-run variance.
