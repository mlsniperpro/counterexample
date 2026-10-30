# Friction log

Every problem we hit with a sponsor tool (Nebius Token Factory, Nebius AI Cloud, NVIDIA Nemotron, Tavily), logged as it happened, with exact error text. Newest last.

## 2026-10-24: Token Factory model ids only found through third-party listings

- **Tool:** Nebius Token Factory docs.
- **What happened:** we needed exact model ids for Nemotron 3 Ultra and a Nano/Super model. Web search returned only third-party catalogs (aggregators and price trackers), not a Nebius page. They agree on `nvidia/Nemotron-3-Ultra-550b-a55b` and `nvidia/nemotron-3-super-120b-a12b` (note the inconsistent capitalisation between the two). No Nemotron 3 Nano id on Token Factory turned up at all.
- **Impact:** ids are defaults in `src/lib/models/config.ts` and `.env.example`, overridable by `MODEL_REASONING` / `MODEL_FAST`. **Owner to verify** against the Token Factory model list (`GET /v1/models`) before the demo.
- **Ask:** a public, crawlable model catalog page with exact ids and per-token prices.

## 2026-10-24: Token Factory and Nebius docs unreachable from the build sandbox

- **Tool:** Token Factory API and Nebius docs.
- **What happened:** our cloud build session's network policy blocks the Nebius hosts. Exact errors:
  - `curl https://docs.tokenfactory.nebius.com/` → `curl: (56) CONNECT tunnel failed, response 403`
  - `curl https://api.tokenfactory.nebius.com/v1/models` → `curl: (56) CONNECT tunnel failed, response 403`
  - `curl https://docs.nebius.com/serverless/` → `curl: (56) CONNECT tunnel failed, response 403`
  - Proxy log: `gateway answered 403 to CONNECT (policy denial or upstream failure)` for each host.
- **Not a Nebius bug:** it is our environment's allow-list. Tavily (`api.tavily.com`) was reachable (`401` without a key, as expected).
- **Impact:** the live path is implemented and unit-tested against a mocked endpoint but **not yet run against Token Factory**. Owner to verify with a key, from a machine that can reach `api.tokenfactory.nebius.com`.
- **Update 2026-10-26:** `curl https://docs.nebius.com/serverless/endpoints/manage` returned `200` from the session that revised `docs/NEBIUS-SANDBOX.md`, which re-read the `nebius ai endpoint create` flags there. Those commands are still unrun against the live CLI (`BLOCKED.md`).

## 2026-10-24: No keys in the build session

- **Tool:** Token Factory, Tavily.
- **What happened:** `NEBIUS_API_KEY` and `TAVILY_API_KEY` were not set in the session, so the live benchmark could not run. Everything runs in deterministic replay mode instead; `pnpm bench --live` is ready for the owner.

## 2026-10-24: Nebius Serverless Jobs executor (P1) blocked at first (superseded below)

- **Tool:** Nebius AI Cloud / Serverless Jobs.
- **What happened:** with the Nebius docs blocked from the build session (above) and no AI Cloud credentials, we could not read the Jobs API or test a container run, so we did not build the executor. The `Executor` interface (`src/lib/exec/types.ts`) is the integration point: a Jobs executor would build the same harness program (`buildProgram`), submit one job per chunk with stdin JSON, and parse the same JSON-lines output with `runWithRestarts`.
- **Next step:** owner to check the Serverless Jobs docs for (a) passing stdin or a mounted input file, (b) cold-start time per job (an attack sends several small batches, measured in the README's "Load per attack" line, so per-job latency matters), (c) per-job CPU/memory limits.

## 2026-10-24: Judge0 CE default runtimes are old

- **Tool:** Judge0 (not a sponsor, logged for completeness).
- **What happened:** Judge0 CE's default ids are Python 3.8.1 (71) and Node.js 12.14.0 (63). Node 12 lacks `??` and `?.`. We added `JUDGE0_LANG_PYTHON` / `JUDGE0_LANG_JAVASCRIPT` overrides for newer runtimes.

## 2026-10-24: Serverless AI jobs have no REST endpoint for job output

- **Tool:** Nebius AI Cloud, Serverless AI jobs.
- **What happened:** `api.nebius.cloud` was reachable from the build session (`curl https://api.nebius.cloud/openapi.json` returned `200`, 1.5 MB), unlike the Token Factory hosts. The OpenAPI spec lists `/ai/v1/jobs` (create, list), `/ai/v1/jobs/{id}` (get, delete), `cancel`, `restart` and `get-by-name`. A job's status has state, timestamps and endpoints, but **no REST endpoint returns a job's stdout or logs**. Logs go through the logging stack (CLI `nebius ai job logs`, or Loki and logcli). Each job also provisions its own VM.
- **Impact:** a "Serverless Jobs executor" that submits each batch of inputs as a job would need a second channel to read results back (a public port, object storage, or the logging API), and would pay VM provisioning time per batch. An interactive attack makes several sandbox calls (see "Load per attack" in the README).
- **What we did:** we built the P1 as a **Serverless AI endpoint** running our own Judge0-compatible sandbox (`sandbox/`, `docs/NEBIUS-SANDBOX.md`). It is warm, takes token auth, and is reached through the existing `Judge0Executor`.
- **Ask:** a `GET /ai/v1/jobs/{id}/logs` (or output) REST endpoint would make jobs usable as a batch code runner from serverless apps.

## 2026-10-27: Our default fast model is scheduled for removal on 2026-11-09

- **Tool:** Nebius Token Factory (model lifecycle).
- **What happened:** Token Factory's deprecation notice (https://docs.tokenfactory.nebius.com/model-deprecations-november-2026.md) says: "These models will be removed from Token Factory Serverless on November 9, 2026." The list includes our default fast model `nvidia/nemotron-3-super-120b-a12b`, with `nvidia/Nemotron-3.5-Super-VL` as the recommended replacement. It also lists `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, with `nvidia/Nemotron-3_5-Lightning` as the replacement. The page says "Token Factory does not automatically reroute requests from deprecated models". The reasoning default, `nvidia/Nemotron-3-Ultra-550b-a55b`, is not on that page; it is also not named anywhere in the official docs, so only `GET /v1/models` can confirm it.
- **Impact:** a deployment that keeps the default fast id stops working on 9 November, before judging, which comes after the 30 October submission deadline. We kept the default, which works for the submission and the demo recording, and made the removal impossible to miss:
  - `MODEL_REMOVALS` in `src/lib/models/config.ts` holds the announced dates and replacements;
  - `pnpm preflight` adds a "config: model removals" check that names the date and the replacement before it, and fails from it;
  - `BLOCKED.md` has the owner step: set `MODEL_FAST` (and add its price to `MODEL_PRICES`) before 2026-11-09.

  We did not switch the default now. The replacement is listed among image-to-text models, and no call has confirmed it follows the generator prompt; switching blind could break the one path that works today.
- **Ask:** deprecation dates and replacements on each model's card, and a `deprecated_at` field in `GET /v1/models`, so tools can warn by themselves.

## 2026-10-27: Token Factory docs reachable again, with a model list we had missed

- **Tool:** Token Factory docs.
- **What happened:** `https://docs.tokenfactory.nebius.com/` now answers 200 from the build session, and `GET /v1/models` answers 401 without a key (it was 403 at the proxy on 2026-10-24). The docs now give Nemotron ids in the deprecation notices: `nvidia/nemotron-3-super-120b-a12b`, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, `nvidia/Nemotron-3_5-Lightning`, `nvidia/Nemotron-3.5-Super-VL` and `nvidia/Llama-3_1-Nemotron-Ultra-253B-v1`; the August 2026 notice removed the last one and pointed it to Super. No page lists `nvidia/Nemotron-3-Ultra-550b-a55b`, so the reasoning default is still from third-party catalogs, and `GET /v1/models` with a key settles it (`BLOCKED.md`). The structured-output page (https://docs.tokenfactory.nebius.com/ai-models-inference/json.md) documents `response_format` with `json_object` and `json_schema`, and says to use the "JSON mode" tag on a model card to find a model that supports structured output.

## 2026-10-27: Token Factory Sandboxes found late, not evaluated

- **Tool:** Token Factory Sandboxes (https://docs.tokenfactory.nebius.com/sandboxes/overview.md).
- **What happened:** the overview describes an environment that gives "applications and AI agents an isolated environment to execute code, evaluate results, and work with files". It is in beta, and access is by request. Each run is an asynchronous operation that starts fresh compute from an image. We found it on 2026-10-27, after our executor was built: the docs were unreachable from the build session until then (entry above), and we have no account to request access.
- **Impact:** not tried. Our executor interface (`src/lib/exec/types.ts`) takes a batch of inputs and returns one outcome per input; a Sandboxes executor would fit behind it like the Judge0 one. The one thing to measure first is the per-operation start-up cost, since an attack sends 31 to 385 or more Judge0-sized batches (median 56.5, `bench/results/fixture.md`). The documented limits (https://docs.tokenfactory.nebius.com/sandboxes/operate/limits-retention-and-usage.md) fit our design: "Simultaneous operations: 50 during Beta", recorded stdout and stderr "maximum: 10 MiB per stream" (our cap is 8 MB), and "`networking.enabled=false` starts the VM without a guest network interface". Until then the attacked code runs in our own Judge0-compatible sandbox, designed for a Nebius Serverless AI endpoint (`docs/NEBIUS-SANDBOX.md`).
- **Ask:** Sandboxes limits and pricing on the overview page, and a batch run (many inputs, one start-up) for evaluation workloads like ours.

