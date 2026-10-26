AUDITED_COMMIT: PENDING
OPEN_CRITICAL: 0
OPEN_HIGH: 0
CLEAN_AUDITS_IN_A_ROW: 0

# Re-audit log (Counterexample)

Each audit is a full pass over the whole entry, as a strict judge and a hostile senior reviewer: correctness, security, robustness, performance, UX, docs-vs-code truth, and brief compliance. Tools: a manual read plus the `code-review` skill at high effort.

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
