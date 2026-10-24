# Feedback: Token Factory, Nemotron, AI Cloud, Tavily

Kept as we build (required written feedback for the hackathon). Items marked **pending live run** need a key and are listed in `BLOCKED.md`; see `FRICTION.md` for exact errors.

## Nebius Token Factory

**What worked**
- The OpenAI-compatible `/v1/chat/completions` surface meant one ~60-line client (`src/lib/models/nebius.ts`) with no SDK, and the same request shape for every model. Switching Ultra and Super per stage is just a different `model` string.
- `usage.prompt_tokens` / `completion_tokens` in the response are what our per-step cost panel needs.

**What didn't / friction**
- We could not find an official, crawlable page listing exact model ids and prices; only third-party catalogs had them, with inconsistent capitalisation (`nvidia/Nemotron-3-Ultra-550b-a55b` vs `nvidia/nemotron-3-super-120b-a12b`). A public catalog page (or a documented unauthenticated `GET /v1/models`) would save every team a guess.
- **Pending live run:** onboarding with the `NEBIUS-DEVPOST-GLOBAL26` credit code and whether billing accepts a Kenyan account; rate limits on Ultra under ~10 concurrent calls; real latency for Ultra vs Super (our fixture mode simulates it).

**Would we use it again?** Yes for this kind of agent: one OpenAI-compatible endpoint serving both a large reasoning model and a fast model is exactly what per-step routing needs. The verdict gets revisited with real latency and cost numbers after the live benchmark.

## NVIDIA Nemotron models

- The Ultra / Super split maps cleanly onto an agent: Ultra where a mistake is expensive (the oracle, the root cause), Super where many cheap tries are fine (generators). Our benchmark measures routed vs Ultra-only cost and latency so the split is a number, not a slogan.
- **Pending live run:** does Ultra's reasoning output arrive in `content` or a separate field, and does it include `<think>` blocks? We strip `<think>...</think>` defensively (`stripThinking`).
- **Pending live run:** how reliably each model follows "answer with one JSON object" for the generator DSL. Every family is validated and invalid ones are dropped with a trace warning, so this is measurable from a live trace.

## Nebius AI Cloud (Serverless endpoints and Jobs)

- We built the P1 sandbox as a Nebius Serverless AI endpoint instead of a Jobs executor: Jobs have no REST endpoint for reading a job's logs, so a job's output cannot be collected per run (exact details in `FRICTION.md`). The sandbox (`sandbox/`, deploy steps in `docs/NEBIUS-SANDBOX.md`) is a small Judge0-compatible container; it is tested locally in Docker, and deploying it needs Nebius AI Cloud credentials (owner step in `BLOCKED.md`).
- What would help: a documented way to stream or fetch a job's stdout over REST, and per-request CPU limits on endpoints.

## Tavily

- Simple API (`POST /search` with a bearer key), results come with URLs, which is exactly what citation-first tracing needs.
- We use it narrowly: only when a statement leans on external facts. The trace shows each query, the cited facts, and which generator families cited them.
- **Pending live run:** quality of results for "LeetCode N official constraints" style queries, and whether `search_depth: "advanced"` is worth the extra credits.
