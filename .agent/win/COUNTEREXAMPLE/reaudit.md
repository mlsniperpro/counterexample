AUDITED_COMMIT: PENDING
OPEN_CRITICAL: 0
OPEN_HIGH: 0
CLEAN_AUDITS_IN_A_ROW: 0

# Re-audit log (Counterexample)

Each audit is a full pass over the whole entry, as a strict judge and a hostile senior reviewer: correctness, security, robustness, performance, UX, docs-vs-code truth, and brief compliance. Tools: a manual read plus the `code-review` skill at high effort.

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
