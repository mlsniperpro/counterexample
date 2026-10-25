AUDITED_COMMIT: PENDING
OPEN_CRITICAL: 0
OPEN_HIGH: 0
CLEAN_AUDITS_IN_A_ROW: 0

# Re-audit log (Counterexample)

Each audit is a full pass over the whole entry, as a strict judge and a hostile senior reviewer: correctness, security, robustness, performance, UX, docs-vs-code truth, and brief compliance. Tools: a manual read plus the `code-review` skill at high effort.

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
