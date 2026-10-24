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

## 2026-10-24: No keys in the build session

- **Tool:** Token Factory, Tavily.
- **What happened:** `NEBIUS_API_KEY` and `TAVILY_API_KEY` were not set in the session, so the live benchmark could not run. Everything runs in deterministic replay mode instead; `pnpm bench --live` is ready for the owner.

## 2026-10-24: Nebius Serverless Jobs executor (P1) not attempted yet

- **Tool:** Nebius AI Cloud / Serverless Jobs.
- **What happened:** with the Nebius docs blocked from the build session (above) and no AI Cloud credentials, we could not read the Jobs API or test a container run, so we did not build the executor. The `Executor` interface (`src/lib/exec/types.ts`) is the integration point: a Jobs executor would build the same harness program (`buildProgram`), submit one job per chunk with stdin JSON, and parse the same JSON-lines output with `runWithRestarts`.
- **Next step:** owner to check the Serverless Jobs docs for (a) passing stdin or a mounted input file, (b) cold-start time per job (the agent runs ~10 to 40 small batches per attack, so per-job latency matters), (c) per-job CPU/memory limits.

## 2026-10-24: Judge0 CE default runtimes are old

- **Tool:** Judge0 (not a sponsor, logged for completeness).
- **What happened:** Judge0 CE's default ids are Python 3.8.1 (71) and Node.js 12.14.0 (63). Node 12 lacks `??` and `?.`. We added `JUDGE0_LANG_PYTHON` / `JUDGE0_LANG_JAVASCRIPT` overrides for newer runtimes.

## 2026-10-24: Serverless AI jobs have no REST endpoint for job output

- **Tool:** Nebius AI Cloud, Serverless AI jobs.
- **What happened:** `api.nebius.cloud` was reachable from the build session (`curl https://api.nebius.cloud/openapi.json` returned `200`, 1.5 MB), unlike the Token Factory hosts. The OpenAPI spec lists `/ai/v1/jobs` (create, list), `/ai/v1/jobs/{id}` (get, delete), `cancel`, `restart` and `get-by-name`. A job's status has state, timestamps and endpoints, but **no REST endpoint returns a job's stdout or logs**. Logs go through the logging stack (CLI `nebius ai job logs`, or Loki and logcli). Each job also provisions its own VM.
- **Impact:** a "Serverless Jobs executor" that submits each batch of inputs as a job would need a second channel to read results back (a public port, object storage, or the logging API), and would pay VM provisioning time per batch. An interactive attack makes 17 to 47 sandbox calls.
- **What we did:** we built the P1 as a **Serverless AI endpoint** running our own Judge0-compatible sandbox (`sandbox/`, `docs/NEBIUS-SANDBOX.md`). It is warm, takes token auth, and is reached through the existing `Judge0Executor`.
- **Ask:** a `GET /ai/v1/jobs/{id}/logs` (or output) REST endpoint would make jobs usable as a batch code runner from serverless apps.
