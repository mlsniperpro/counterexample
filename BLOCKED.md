# Blocked on inputs only the owner can provide

Everything below already has a working path behind replay fixtures or a stub; each item turns on the moment the input arrives.

- [ ] **`NEBIUS_API_KEY`** (Token Factory, credit code `NEBIUS-DEVPOST-GLOBAL26` plus Builders Program credit) set in `.env.local` and in Vercel env. Unlocks live mode in the UI and `pnpm bench --live --readme`.
- [ ] **Token Factory billing for a Kenyan account** confirmed (account sign-up and payment method).
- [ ] **Model ids confirmed** from Token Factory's model list (`GET https://api.tokenfactory.nebius.com/v1/models` with the key). Current defaults: `MODEL_REASONING=nvidia/Nemotron-3-Ultra-550b-a55b`, `MODEL_FAST=nvidia/nemotron-3-super-120b-a12b`. If a Nemotron 3 Nano id exists, set it as `MODEL_FAST` and rerun the benchmark.
- [ ] **Prices confirmed** from the Token Factory console; set `MODEL_PRICES` if they differ from the defaults in `src/lib/models/pricing.ts`.
- [ ] **`TAVILY_API_KEY`** set (enables the research stage in live mode).
- [ ] **Judge0 endpoint**: `JUDGE0_URL` plus `JUDGE0_TOKEN` (self-hosted Judge0 CE, or a RapidAPI subscription with `JUDGE0_RAPIDAPI_HOST`). Required for the public preview: production refuses the local executor.
- [ ] **Vercel project** linked to the repo, env vars above set, preview URL pasted into `SUBMISSION.md`.
- [ ] **Network access**: a machine (or a cloud environment with `api.tokenfactory.nebius.com` and `docs.nebius.com` allowed) to run the live benchmark. The build session's policy denied those hosts.
- [ ] **Nebius AI Cloud credentials** (project id + service account) if the Serverless Jobs executor (P1) is to be built and tested.
- [ ] **Demo video** filmed per `docs/VIDEO.md`, uploaded public on YouTube, link in `SUBMISSION.md`.
- [ ] **Repo visibility**: make `mlsniperpro/counterexample` public before submission (MIT `LICENSE` is in place).
- [ ] **Devpost submission** and the written feedback form (paste from `docs/FEEDBACK.md`).
