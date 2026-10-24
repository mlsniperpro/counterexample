# Demo video shot list (target 2:45, hard limit 2:50)

Public on YouTube. Screen recording of the deployed preview (or `pnpm dev` in live mode) plus a terminal. Voice-over lines in quotes.

| Time | Shot | Voice-over / on screen |
| --- | --- | --- |
| 0:00–0:12 | Title card: "Counterexample". Cut to the app. | "Tests passing isn't the same as correct. Counterexample attacks your code the way a strong interviewer would." |
| 0:12–0:30 | Pick **Binary search**. Show the buggy code (looks fine). | "Here's a binary search that passes both examples." |
| 0:30–0:55 | Click **Attack**. Live trace: research stage with Tavily citations (LeetCode 704 constraints). | "The statement references LeetCode's constraints, so Tavily fetches them, and every fact is cited in the trace." |
| 0:55–1:15 | Trace: oracle stage, model call shows **Nemotron 3 Ultra** and its "why". | "Nemotron Ultra writes a slow, obviously-correct brute force, and it has to pass the examples before we trust it." |
| 1:15–1:35 | Trace: attack stage, **Nemotron Super** generator families; one family cites the LeetCode fact. Run stage counts. | "Super designs input generators, not test cases: single-element arrays, targets at the ends. Hundreds of inputs run in the sandbox." |
| 1:35–1:55 | Result card: minimal counterexample `solve([0], 0)` expected 0, got -1; "shrunk from … in N steps". | "Any mismatch is shrunk with delta debugging to the smallest input that still fails." |
| 1:55–2:15 | Explanation + fix; "re-attacked on 900+ inputs: 0 failures". | "Ultra explains the bug in two sentences and proposes a fix, and the fix is re-attacked before we call it fixed." |
| 2:15–2:30 | **Why Ultra here, Super there** panel: model, tokens, cost, latency per step. Toggle "Ultra for everything" and rerun briefly to show cost go up. | "Ultra where a mistake is expensive, Super where speed wins. It's cheaper and faster than Ultra everywhere." |
| 2:30–2:42 | Terminal: `pnpm bench` summary table (bugs found, false alarms, cost routed vs Ultra-only). | "On our benchmark of 30 buggy and 10 correct solutions: [read the numbers from bench/results/live.md]." |
| 2:42–2:50 | Closing card: repo URL, MIT, "Nebius Token Factory + NVIDIA Nemotron". | "Built by the AlgoCracked team, for interview prep and for checking AI-written code before you merge it." |

Checklist before recording: live mode on (badge says "Live: Nebius Token Factory"), Judge0 configured (badge shows Judge0, not the local executor), model ids verified, and live benchmark numbers produced: run `pnpm bench --live --readme`, which writes `bench/results/live.md` (and the README's live section). That file does not exist until this live run; until then only `bench/results/fixture.md` (replay mode) exists, and its numbers must not be presented as live.
