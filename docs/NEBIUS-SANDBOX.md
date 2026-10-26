# Running user code on Nebius AI Cloud

Counterexample never runs user code on the web server. Code runs in a sandbox that speaks the Judge0 API subset used by `Judge0Executor`. Two options:

- any Judge0 deployment (self-hosted Judge0 CE or RapidAPI), or
- **the Counterexample sandbox** (`sandbox/server.mjs` + `sandbox/Dockerfile`): one small container, Node standard library only, deployable as a **Nebius Serverless AI endpoint**. This is the recommended path: the agent's models run on Nebius Token Factory and the code they attack runs on Nebius AI Cloud.

## What the sandbox enforces

Per submission:
- a fresh temp directory, readable only by the run's uid and writable by nobody but the server, so a run cannot create files there;
- a CPU-time limit (`ulimit -t`) and a wall-clock limit;
- memory: a per-process address-space limit (`RLIMIT_AS`: `memory_limit` for Python; 1024 MB + 1.25 x the heap for Node, which reserves ~750 MB of address space just to start), and a **per-run** limit: the RSS of all the run's processes together is sampled every 50 ms and the run is killed past `memory_limit` + 64 MB (tested with a Node `Buffer` bomb and with 20 forked Python children of 40 MB each);
- `ulimit -f` 16 MB per file, `ulimit -n` 256 open files, and an OOM score of 1000, so if the container limit is ever hit the kernel kills run processes before the server;
- **no network**: a seccomp filter, installed by a small Python launcher before the program starts, makes `socket()` fail with `EACCES` for every address family (internet, `169.254.169.254`, the Docker bridge and other sandboxes, loopback, `AF_UNIX`), and also denies `memfd_create`, SysV/POSIX IPC and `io_uring` (no way around the filter, or to hold memory outside it). It needs no capability, so it works in a plain `docker run`, on Nebius Serverless, and in `pnpm sandbox`. Tested: connections to all of those addresses and `fetch()` fail;
- an 8 MB output cap;
- a minimal environment (no server variables or secrets reach user code; tested);
- its run slot's own unprivileged uid (20000 + slot; `SANDBOX_UID_BASE` moves the range, so two servers on one host do not kill each other's runs), so it cannot read the server's environment (the token) or another submission's directory, may own at most 64 processes (threads included), and every process of that uid is killed when the run ends: a forked child cannot outlive the run, hold its slot, or touch the next submission (tested, including a child that calls `setsid`). Then anything the uid left at the top of `/tmp`, `/dev/shm` and `/var/tmp` is deleted (tested).

Per server:
- at start it checks that the network filter works and reports it in `GET /health`: `{"ok":true,…,"isolation":{"uid":true,"network":"blocked","sharedDirs":"locked"}}`. If the filter does not work on the host (`"network":"unavailable"`), `/health` answers 503 and every submission is refused with 503: it fails closed. `SANDBOX_ALLOW_NETWORK=1` skips the filter, only for a platform that already gives the container no network;
- in the image, `/tmp`, `/dev/shm` and `/var/tmp` are not writable by run uids (`sharedDirs: "locked"`): the image is built with no world-writable directory, and the server locks fresh mounts at start;
- a bounded run queue that answers 503 with `Retry-After` when full (`Judge0Executor` retries);
- request size limits;
- token auth via `X-Auth-Token` or `Authorization: Bearer`, compared in constant time. The image refuses to start without `SANDBOX_TOKEN`; outside it, without a token the server listens on `127.0.0.1` only (with one, on every interface);
- the server process runs as root inside the container only to switch each run to its slot uid; submitted code never runs as root.

Container flags (defence in depth; the filter above does not depend on them):
- `--memory 2g` and `--pids-limit 512` bound the whole container, the backstop behind the per-run limits;
- `--read-only --tmpfs /tmp:size=64m --tmpfs /dev/shm:size=1m`: bounded, RAM-backed temp dirs that the server itself uses (run uids cannot write them);
- `--cap-drop ALL` plus the six capabilities the server needs: `CHOWN DAC_OVERRIDE FOWNER SETUID SETGID KILL`; `--security-opt no-new-privileges`;
- `--network none` would deny the container all network, but it also disables port publishing: with `--network none -p 2390:2358` the port is not published (`docker port` prints nothing, `curl` cannot connect; checked on Docker 29.9.2). So it is not usable for a sandbox you call over HTTP; the per-run filter is what blocks the network.

Without root (`pnpm sandbox`), runs share the server's uid: the network filter, the limits and the per-run memory limit (by process group) still apply, but runs are not isolated from each other or from your files; the server warns about this at start, and it is for development only.

Verified in the build session (Docker 29.9.2):
- `docker build -t counterexample-sandbox sandbox/` succeeded.
- `docker run --read-only --tmpfs /tmp -e SANDBOX_TOKEN=… counterexample-sandbox`, then `pnpm preflight` passed `config: sandbox`, `judge0: languages` and `judge0: run`.
- `pnpm bench --only binary-search` against the container gave all 12 expected verdicts.
- Security fixes (2026-10-25, Docker 29.9.2, kernel 6.18): with both a plain `docker run -p 2390:2358 -e SANDBOX_TOKEN=…` and the hardened flags below, submissions that connect to `169.254.169.254:80`, `172.17.0.1:2358`, `example.com:80` and `127.0.0.1:2358` all got `EACCES`; writes to `/tmp`, `/dev/shm`, `/var/tmp` and the run directory were denied; a Node `Buffer` bomb at `memory_limit` 64 MB stopped at 64 MB; a 20-child fork bomb was killed with `memory limit 64 MB exceeded`; `/health` reported `"network":"blocked","sharedDirs":"locked"`.

## Deploy as a Nebius Serverless AI endpoint (owner, needs Nebius AI Cloud credentials)

1. Push the image to a registry the endpoint can pull from (for example the Nebius Container Registry, or GHCR):
   ```bash
   docker build -t <registry>/counterexample-sandbox:1 sandbox/
   docker push <registry>/counterexample-sandbox:1
   ```
2. Create the endpoint. It is CPU only, on platform `cpu-d3`, preset `4vcpu-16gb`; CPU-only workloads need at least 20 GiB of disk. Endpoint token auth makes callers send `Authorization: Bearer <token>`; use the same token for `SANDBOX_TOKEN` (the image will not start without it). No extra capability or flag is needed for network isolation: the per-run seccomp filter works unprivileged. The preset's memory is the container's memory limit.
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
5. Check: `pnpm preflight` must show `PASS judge0: languages` and `PASS judge0: run`, and `curl -s https://<endpoint-url>/health` must show `"network":"blocked"` (a 503 with `"network":"unavailable"` means the platform does not allow seccomp filters, and the sandbox refuses to run code).

Sources:
- [Managing endpoints in Serverless AI](https://docs.nebius.com/serverless/endpoints/manage): the `nebius ai endpoint create` flags, `--auth token` (Bearer), and the URL lookup.
- [VM types](https://docs.nebius.com/compute/virtual-machines/types): `cpu-d3` presets.

## Why an endpoint and not a Serverless Job per batch

A job provisions a VM per run, and the jobs API has no endpoint for reading a job's output back. The [REST API](https://docs.nebius.com/rest-api/ai/v1/jobs/create) creates jobs and reports state; logs go through the logging stack.

An interactive attack makes several sandbox calls ("Load per attack" in the README, measured on the benchmark), each expected in well under a second. A warm endpoint fits that pattern; a VM per batch does not.

## Run it locally

- `pnpm sandbox` starts the same server on `127.0.0.1:2358` (every interface only if `SANDBOX_TOKEN` is set); set `JUDGE0_URL=http://localhost:2358`.
- Or use Docker (the image requires a token; set `JUDGE0_TOKEN` to the same value):
  ```bash
  docker run --rm -p 127.0.0.1:2358:2358 -e SANDBOX_TOKEN=change-me \
    --read-only --tmpfs /tmp:size=64m --tmpfs /dev/shm:size=1m \
    --memory 2g --pids-limit 512 \
    --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETUID --cap-add SETGID --cap-add KILL \
    --security-opt no-new-privileges \
    counterexample-sandbox
  ```
  Do not add `--network none`: it also stops `-p` from publishing the port.
- Two servers on one host (say `pnpm sandbox` while `pnpm test` runs) need different uid ranges: `SANDBOX_UID_BASE=30000 pnpm sandbox`.
