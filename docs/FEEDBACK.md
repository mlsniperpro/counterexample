# Feedback: Token Factory, Nemotron, AI Cloud, Tavily

Kept as we build (required written feedback for the hackathon). Items marked **pending live run** need a key and are listed in `BLOCKED.md`; see `FRICTION.md` for exact errors.

## Nebius Token Factory

**What worked**
- The OpenAI-compatible `/v1/chat/completions` surface meant one client of under 100 lines (`src/lib/models/nebius.ts`) with no SDK, and the same request shape for every model. Switching Ultra and Super per stage is just a different `model` string.
- `usage.prompt_tokens` / `completion_tokens` in the response are what our per-step cost panel needs.

**What didn't / friction**
- On 2026-10-24 we could not reach any official page listing exact model ids and prices (the docs were blocked from our build session); only third-party catalogs had them, with inconsistent capitalisation (`nvidia/Nemotron-3-Ultra-550b-a55b` vs `nvidia/nemotron-3-super-120b-a12b`). When the docs became reachable on 2026-10-27, Nemotron ids appeared only in deprecation notices, and the Ultra id appeared nowhere. A public catalog page (or a documented unauthenticated `GET /v1/models`) would save every team a guess.
- **Model lifecycle:** our default fast model, `nvidia/nemotron-3-super-120b-a12b`, is announced for removal on 2026-11-09, before judging, and requests are not rerouted (`FRICTION.md`, 2026-10-27). We added a preflight check against the announced removals; a `deprecated_at` field in `GET /v1/models` would let every tool do that without a hand-kept table.
- **Pending live run:** onboarding with the `NEBIUS-DEVPOST-GLOBAL26` credit code and whether billing accepts a Kenyan account; rate limits on Ultra under ~10 concurrent calls; real latency for Ultra vs Super (our fixture mode simulates it).

**Would we use it again?** Yes for this kind of agent: one OpenAI-compatible endpoint serving both a large reasoning model and a fast model is exactly what per-step routing needs. The verdict gets revisited with real latency and cost numbers after the live benchmark.

## NVIDIA Nemotron models

Everything here comes from reading docs and building against the API shape. No live Nemotron call has run yet (`BLOCKED.md`).

**What worked**
- The Ultra / Super split maps cleanly onto an agent: Ultra where a mistake is expensive (the oracle, the root cause), Super where many cheap tries are fine (generators, research summaries). Our benchmark compares routed with Ultra-only cost and latency, so the split is a number, not a slogan (in replay mode the cost comes from replayed token counts and the latency is simulated; the live run measures both).
- Because model output is interpreted (a JSON DSL, schema-checked), never executed, a weaker answer from the fast model costs a dropped family, not a false alarm. That made it safe to give Super the high-volume step.

**What didn't / open questions (pending live run)**
- Does Ultra's reasoning arrive in `content` or a separate field, and does it include `<think>` blocks? We strip `<think>...</think>` defensively (`stripThinking` in `src/lib/agent/parse.ts`).
- How reliably each model follows "answer with one JSON object" for the generator DSL. Token Factory documents `response_format` (`json_object` and `json_schema`) for models whose card has the "JSON mode" tag; we do not send it yet, since we could not see which Nemotron cards carry the tag. Every family is validated and invalid ones are dropped with a trace warning, so the rejection rate is measurable from a live trace, and it is the number that would justify switching to `json_schema`.

**Onboarding**
- The model ids came only from third-party catalogs, with inconsistent capitalisation: `nvidia/Nemotron-3-Ultra-550b-a55b` vs `nvidia/nemotron-3-super-120b-a12b` (`FRICTION.md`, 2026-10-24). The hackathon overview suggests "Nano or Super" for fast calls. The Nano ids we later found in the docs are both being retired: `nvidia/Nemotron-3-Nano-Omni` was removed on 2026-08-31, and `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` is announced for removal on 2026-11-09 (both point to `nvidia/Nemotron-3_5-Lightning`), so we default to Super, which is announced for removal on the same day (`BLOCKED.md` has the owner step).
- Asks: a model card per Nemotron model on Token Factory that states (1) the exact id, (2) where reasoning text is returned and whether it can be turned off or capped, (3) whether JSON mode / `response_format` is supported, and (4) the context and output token limits.

**Would we use it again?** Yes, provisionally. The two-tier family is the right shape for a routed agent; we will confirm with the live benchmark's real latency, cost and JSON-rejection numbers.

## Nebius AI Cloud (Serverless endpoints and Jobs)

Based on the public OpenAPI spec, a local Docker build and, for the endpoint command, a late read of the docs (`docs.nebius.com` was blocked from the build session). The endpoint itself is not deployed and the CLI commands have not been run: that needs Nebius AI Cloud credentials (`BLOCKED.md`).

**What worked**
- `https://api.nebius.cloud/openapi.json` is public and was reachable from our build session (`200`, 1.5 MB), so we could check the Jobs API without an account.
- The endpoint docs (read after the build, on 2026-10-26, because `docs.nebius.com` returned 403 to the build session; `docs/FRICTION.md`) give one `nebius ai endpoint create` command with `--auth token` (callers send `Authorization: Bearer`), which our `Judge0Executor` already speaks (`JUDGE0_AUTH=bearer`). Our deploy commands follow that page but are not yet verified against the live CLI. We built the P1 as a small Judge0-compatible sandbox (`sandbox/`, steps in `docs/NEBIUS-SANDBOX.md`) to run as a CPU-only endpoint (`cpu-d3`, `4vcpu-16gb`). The image builds and passes `pnpm preflight` and the benchmark locally.

**What didn't**
- Serverless Jobs do not fit a batch code runner: the spec has create, list, get, delete, cancel, restart and get-by-name, but **no REST endpoint returns a job's stdout or logs** (only the CLI `nebius ai job logs`, or Loki), and each job provisions its own VM. An interactive attack makes several sandbox calls ("Load per attack" in the README), each expected in well under a second.
- **Token Factory Sandboxes** (beta, access by request) is described as an isolated environment for agents to "execute code, evaluate results". We found it only on 2026-10-27 and have not tried it (`FRICTION.md`). It looks like the natural home for this project's runs; what we would need to know first is the per-operation start-up cost, since an attack sends 31 to 385 or more Judge0-sized batches (median 57, `bench/results/fixture.md`). Its documented limits fit: 50 simultaneous operations in beta, recorded stdout and stderr of up to 10 MiB per stream (our cap is 8 MB), and `networking.enabled=false` for a VM with no network.
- `docs.nebius.com` was blocked by our build session's allow-list (`CONNECT tunnel failed, response 403`); that is our environment, not Nebius.

**Onboarding**
- Pending: account, project id and CLI login. The deploy path is five commands (`docs/NEBIUS-SANDBOX.md`); we have not timed it.
- Asks: (1) `GET /ai/v1/jobs/{id}/logs` (or an output endpoint), which would make Jobs usable from serverless apps; (2) document whether an endpoint can run with no outbound network, the main isolation control for a code sandbox; (3) per-request CPU limits on endpoints.

**Would we use it again?** Endpoints, yes: a warm container with token auth is the right shape for running attacked code next to Token Factory. Jobs, not for interactive work until job output is readable over REST.

## Tavily

Based on building the client and its mocked-HTTP tests. `api.tavily.com` was reachable from the build session (`401` without a key, as expected), but no key was available, so no live search has run (`BLOCKED.md`).

**What worked**
- Simple API (`POST /search` with a bearer key), and every result carries a URL, which is exactly what citation-first tracing needs.
- We research two things: the problem's sources (official constraints) and the docs of risky APIs the code calls (`src/lib/research/plan.ts`: JavaScript's default `sort()`, 32-bit bitwise operators, `Math.round`, Python's `round()`). At most two searches per attack (`MAX_QUERIES`), `search_depth: "basic"`, `max_results: 5`, `include_answer: false`.
- Every fact must cite a URL from its own search's results, or it is dropped with a trace warning; a generator family may cite only facts from this run, and the report lists which families research shaped.

**What didn't / open questions (pending live run)**
- Quality of results for "LeetCode N official constraints" style queries and for API-doc queries (does MDN rank first for "Array.prototype.sort default sort order"?), and whether `search_depth: "advanced"` is worth the extra credits.

**Onboarding**
- Pending a key. Reachability and the auth error were checked; nothing else needed setting up.
- Asks: document which result fields are guaranteed non-null (we treat `title` and `content` as optional and drop results with a non-http(s) `url`), and the maximum query length (we cap queries at 400 characters to be safe).

**Would we use it again?** Yes. A cited search behind one POST is the right size for an agent stage that must justify every input it generates.
