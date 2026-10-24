# Running user code on Nebius AI Cloud

Counterexample never runs user code on the web server. Code runs in a sandbox that speaks the Judge0 API subset used by `Judge0Executor`. Two options:

- any Judge0 deployment (self-hosted Judge0 CE or RapidAPI), or
- **the Counterexample sandbox** (`sandbox/server.mjs` + `sandbox/Dockerfile`): one small container, Node standard library only, deployable as a **Nebius Serverless AI endpoint**. This is the recommended path: the agent's models run on Nebius Token Factory and the code they attack runs on Nebius AI Cloud.

## What the sandbox enforces

Per submission:
- a fresh temp directory;
- a CPU-time limit (`ulimit -t`) and a wall-clock limit;
- a memory limit (`ulimit -v` for Python, `--max-old-space-size` for Node);
- a 32 MB output cap;
- a minimal environment (no server variables or secrets reach user code; tested);
- its run slot's own unprivileged uid (20000 + slot), so it cannot read the server's environment (the token) or another submission's directory, may own at most 64 processes, and every process of that uid is killed when the run ends: a forked child cannot outlive the run, hold its slot, or touch the next submission (tested, including a child that calls `setsid`).

Per server:
- a bounded run queue that answers 503 with `Retry-After` when full (`Judge0Executor` retries);
- request size limits;
- token auth via `X-Auth-Token` or `Authorization: Bearer`, compared in constant time;
- the server process runs as root inside the container only to switch each run to its slot uid; submitted code never runs as root. The image works with `--read-only --tmpfs /tmp`.

Network isolation comes from the container: deploy the endpoint without outbound access if your platform allows it. Run outside the container without root (`pnpm sandbox`), runs share the server's uid and only the process group is killed; the server warns about this at start, and it is for development only.

Verified in the build session (Docker 29.9.2):
- `docker build -t counterexample-sandbox sandbox/` succeeded.
- `docker run --read-only --tmpfs /tmp -e SANDBOX_TOKEN=… counterexample-sandbox`, then `pnpm preflight` passed `config: sandbox`, `judge0: languages` and `judge0: run`.
- `pnpm bench --only binary-search` against the container gave all 12 expected verdicts.

## Deploy as a Nebius Serverless AI endpoint (owner, needs Nebius AI Cloud credentials)

1. Push the image to a registry the endpoint can pull from (for example the Nebius Container Registry, or GHCR):
   ```bash
   docker build -t <registry>/counterexample-sandbox:1 sandbox/
   docker push <registry>/counterexample-sandbox:1
   ```
2. Create the endpoint. It is CPU only, on platform `cpu-d3`, preset `4vcpu-16gb`; CPU-only workloads need at least 20 GiB of disk. Endpoint token auth makes callers send `Authorization: Bearer <token>`; use the same token for `SANDBOX_TOKEN`.
   ```bash
   TOKEN=$(openssl rand -hex 24)
   nebius ai endpoint create \
     --name counterexample-sandbox \
     --image <registry>/counterexample-sandbox:1 \
     --container-port 2358 \
     --env SANDBOX_TOKEN=$TOKEN \
     --auth token --token $TOKEN \
     --platform cpu-d3 --preset 4vcpu-16gb \
     --disk-size 20Gi
   ```
3. Get its HTTPS URL:
   ```bash
   nebius ai endpoint get <endpoint-id> --format json | jq -r '.status.public_endpoints[] | select(startswith("https://"))' | head -1
   ```
4. Point the app at it (`.env.local` and Vercel):
   ```bash
   JUDGE0_URL=https://<endpoint-url>
   JUDGE0_TOKEN=$TOKEN
   JUDGE0_AUTH=bearer
   ```
5. Check: `pnpm preflight` must show `PASS judge0: languages` and `PASS judge0: run`.

Sources:
- [Managing endpoints in Serverless AI](https://docs.nebius.com/serverless/endpoints/manage): the `nebius ai endpoint create` flags, `--auth token` (Bearer), and the URL lookup.
- [VM types](https://docs.nebius.com/compute/virtual-machines/types): `cpu-d3` presets.

## Why an endpoint and not a Serverless Job per batch

A job provisions a VM per run, and the jobs API has no endpoint for reading a job's output back. The [REST API](https://docs.nebius.com/rest-api/ai/v1/jobs/create) creates jobs and reports state; logs go through the logging stack.

An interactive attack makes a few dozen sandbox calls ("Load per attack" in the README, measured on the benchmark), each expected in well under a second. A warm endpoint fits that pattern; a VM per batch does not.

## Run it locally

- `pnpm sandbox` starts the same server on `:2358`; set `JUDGE0_URL=http://localhost:2358`.
- Or use Docker: `docker run --rm -p 2358:2358 --read-only --tmpfs /tmp counterexample-sandbox`.
