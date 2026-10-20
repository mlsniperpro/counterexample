# Counterexample: an agent that breaks code before your interviewer does (Nebius x NVIDIA Global AI Hackathon brief)

**Hackathon:** Nebius x NVIDIA Global AI Hackathon (Devpost). **Deadline: Thu 2026-10-30 10:00 PT = 20:00 EAT.** **Our freeze is Oct 29 18:00 EAT.**

**Track:** **Coding and Agentic Engineering**: "build coding agents and developer tools: agents that write, run, and test code in Token Factory". **We also aim for Best Use of Tavily ($3k).**

**Prizes:** overall $20k / $10k / $6k; track winners get a Jetson Orin Nano; Tavily $3k; Most Valuable Feedback $100 ×10. **A project wins one overall prize, or one track prize plus one bonus.**

## Rules that shape the build (verified 2026-10-20)

- **Must run on Nebius Token Factory or Nebius AI Cloud and use at least one NVIDIA open model** (Nemotron) **at runtime**. The same models through OpenRouter or Hugging Face **don't count**.
- **Public repo with an open-source licence** visible at the top (MIT).
- **Demo video ≤ 3 min**, public on YouTube, showing it working and how Token Factory and Nemotron are used.
- **Required written feedback** on Token Factory, AI Cloud and NVIDIA tools. Keep `docs/FEEDBACK.md` as you go.
- Four equal criteria: how well it's built and uses Token Factory + Nemotron; creativity (non-obvious, genuine understanding); design; potential impact.
- The overview's own hint: "Reach for **Nemotron 3 Ultra** when you need serious reasoning, and let **Nano or Super** handle the fast, everyday calls".
- **Credits:** $25 with code `NEBIUS-DEVPOST-GLOBAL26`, plus $25 from the Builders Program. The owner checks that Token Factory billing accepts a Kenyan account (a known gap for some countries).

## The idea

**A coding agent that doesn't stop at "tests pass".** You give it a solution to a problem: your interview answer, or AI-written code. It does what a strong interviewer or reviewer does:
1. **Understand:** it reads the problem statement and constraints. **Tavily** fetches the official constraints, edge-case discussions or library docs when the problem references something external, and every fetch is cited in the trace.
2. **Build an oracle:** Nemotron **Ultra** writes a slow but obviously-correct brute-force reference, and **checks it against the examples** first.
3. **Attack:** Nemotron **Super/Nano** generate adversarial input families (bounds, empties, duplicates, overflow, worst-case sizes, degenerate graphs) as **generators**, not hand-written cases.
4. **Run:** it executes the user's solution and the oracle on thousands of generated inputs in a sandbox, then **shrinks** any mismatch to a minimal counterexample (delta debugging).
5. **Explain:** Ultra explains the bug in two sentences with the minimal input, and proposes a fix. **It re-runs the whole attack on the fix** before claiming it works.
6. **Report:** a shareable report showing the trace of every model call (which model, why), every run, the minimal counterexample and timing. A **"Why Ultra here, Nano there" panel** shows cost and latency per step.

**Impact:** coding-interview prep (it's built by the AlgoCracked team), plus everyday developer use (attacking AI-written code before merging). Make the pitch global.

## Build (commit and push after each green step; branch `counterexample`; PR to `main`)

1. **Scaffold:** `create-next-app` (TypeScript, pnpm) for the UI and API routes; MIT `LICENSE`; `README.md`.
2. **Model client:** Token Factory's OpenAI-compatible endpoint (base URL, key and model ids from env: `NEBIUS_BASE_URL`, `NEBIUS_API_KEY`, `MODEL_REASONING` = a Nemotron 3 Ultra id, `MODEL_FAST` = a Nano or Super id). Look up the exact ids in the Token Factory docs. Include a **deterministic replay provider** so tests and judges can run without a key.
3. **Sandbox executor behind an interface:**
   - `Judge0Executor` (any Judge0-compatible API, URL and token from env);
   - `LocalExecutor` (Python and JavaScript only, subprocess with time and memory limits; dev only, clearly labelled);
   - **P1:** a **Nebius AI Cloud / Serverless Jobs** executor for batch runs, if the docs make it practical in the time. That uses one more Nebius service and is the strongest "runs code in Nebius" proof. Log in FRICTION.md if it isn't practical.
4. **Agent loop:** the steps above as explicit, typed stages with budgets (max model calls, max runs, wall-clock), and a structured trace (`trace.jsonl`) streamed to the UI.
5. **Shrinker:** generic delta debugging over structured inputs (arrays, strings, graphs as edge lists). Unit-tested.
6. **Tavily:** a `research` stage that runs only when the problem statement references external facts or the user asks. Results are summarised with citations into the trace, and the trace shows how they changed the generators.
7. **UI:** paste a problem + solution (or pick one of 5 built-in classic problems with subtly buggy solutions: off-by-one binary search, overflow in a midpoint, a greedy that fails on one input, a Dijkstra with negative edges, a sliding window with duplicates). Live trace, minimal counterexample, fix, re-attack result. Phone-width friendly.
8. **Benchmark (`bench/`):** 30 known-buggy solutions (written by you, with the bug documented) and 10 correct ones. Report bug-found rate, time to first counterexample, false alarms on correct ones, and model cost, Ultra-only vs routed. **Every number in the README comes from this script.**
9. **Deploy:** a Vercel preview is fine for the UI. The owner sets env vars. Rate-limit by IP and cap daily model spend.
10. **Docs:** `docs/FEEDBACK.md` (Token Factory, Nemotron models, AI Cloud, Tavily: what worked, what didn't, onboarding, would we use it again), `docs/FRICTION.md`, `docs/VIDEO.md` (≤ 2:50 shot list), `SUBMISSION.md`, `docs/architecture.svg`.

## Checks before each push

`pnpm lint && pnpm typecheck && pnpm test` (shrinker, generators, stage budgets, replay-provider end-to-end on two built-in problems). Don't run `next build` locally.

## Done when

- [ ] Replay-mode end to end in tests; the live run marked "owner to verify with key" if no key is present in the session.
- [ ] Benchmark script and results (fixture mode, and live if a key is present).
- [ ] All docs above.
