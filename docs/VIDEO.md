# Demo video shot list (target 2:45, hard limit 2:50)

Public on YouTube. Screen recording of the deployed preview (or `pnpm dev` in live mode) plus a terminal. Voice-over lines in quotes.

| Time | Shot | Voice-over / on screen |
| --- | --- | --- |
| 0:00–0:12 | Title card: "Counterexample". Cut to the app. | "Tests passing isn't the same as correct. Counterexample attacks your code the way a strong interviewer would." |
| 0:12–0:30 | Pick **Coin change (fewest coins)**. Show the greedy solution (looks fine, passes the examples). | "Here's a coin-change solution that passes every example: take the biggest coin first." |
| 0:30–0:55 | Tick **Research the web**, click **Attack**. Live trace: research stage with a Tavily citation (Wikipedia, change-making problem). | "Tavily looks up what is known about the problem, and every fact is cited in the trace." |
| 0:55–1:15 | Trace: oracle stage, model call shows **Nemotron 3 Ultra** and its "why". | "Nemotron Ultra writes a slow, obviously-correct brute force, and it has to pass the examples before we trust it." |
| 1:15–1:35 | Trace: attack stage, **Nemotron Super** families; `non-canonical-systems` cites the research fact and breaks the greedy. Run stage counts. | "Super designs input generators, not test cases. The cited fact says greedy fails on non-canonical coin systems, so it builds exactly those." |
| 1:35–1:55 | Result card: minimal counterexample `solve([2, 3], 4)` expected 2, got -1; "shrunk from `[[8, 9], 16]` (family non-canonical-systems) in 3 steps". | "The mismatch is confirmed on a fresh run, then shrunk with delta debugging to the smallest input that still fails." |
| 1:55–2:15 | Explanation + fix; "re-attacked on 1,257 inputs: 0 failures". | "Ultra explains the bug in two sentences and proposes a fix, and the fix is re-attacked before we call it fixed." |
| 2:15–2:30 | **Why Ultra here, Super there** panel: model, tokens, cost, latency per step. Toggle "Ultra for everything" and rerun briefly to show cost go up. | "Ultra where a mistake is expensive, Super where speed wins. It's cheaper and faster than Ultra everywhere." |
| 2:30–2:42 | Terminal: `pnpm bench` summary table (bugs found, false alarms, cost routed vs Ultra-only). | "On our benchmark of 30 buggy and 10 correct solutions: [read the numbers from bench/results/live.md]." |
| 2:42–2:50 | Closing card: repo URL, MIT, "Nebius Token Factory + NVIDIA Nemotron". | "Built by the AlgoCracked team, for interview prep and for checking AI-written code before you merge it." |

The numbers above are from the replay run of this demo (`research: force`); read the live run's own numbers off the screen.

Checklist before recording: live mode on (badge says "Live: Nebius Token Factory"), Judge0 configured (badge shows Judge0, not the local executor), model ids verified, and live benchmark numbers produced: run `pnpm bench --live --readme`, which writes `bench/results/live.md` (and the README's live section). That file does not exist until this live run; until then only `bench/results/fixture.md` (replay mode) exists, and its numbers must not be presented as live.
