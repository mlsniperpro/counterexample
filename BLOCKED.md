# Blocked on inputs only the owner can provide

Everything below already has a working path behind replay fixtures or a stub; each item turns on the moment the input arrives.

- [ ] **`NEBIUS_API_KEY`** (Token Factory, credit code `NEBIUS-DEVPOST-GLOBAL26` plus Builders Program credit; account sign-up and billing for a Kenyan account) set in `.env.local` and in Vercel env. Unlocks live mode in the UI and `pnpm bench --live --readme`. Model ids and prices are already decided defaults (`nvidia/Nemotron-3-Ultra-550b-a55b`, `nvidia/nemotron-3-super-120b-a12b`, prices in `src/lib/models/pricing.ts`); with the key in hand, one check finishes this item: `GET https://api.tokenfactory.nebius.com/v1/models` lists both ids, and the console's prices match. Override only on a mismatch (`MODEL_REASONING`, `MODEL_FAST`, `MODEL_PRICES`); a call to an unpriced model is flagged in the report and charged at `UNPRICED_CALL_USD` against the spend cap, so nothing is silently miscounted meanwhile.
- [ ] **`TAVILY_API_KEY`** set (enables the research stage in live mode).
- [ ] **Judge0 endpoint**: `JUDGE0_URL` plus `JUDGE0_TOKEN` (self-hosted Judge0 CE, or a RapidAPI subscription with `JUDGE0_RAPIDAPI_HOST`). Required for the public preview: production refuses the local executor.
- [ ] **Vercel project** linked to the repo, env vars above set, preview URL pasted into `SUBMISSION.md`.
- [ ] **Network access**: a machine (or a cloud environment with `api.tokenfactory.nebius.com` and `docs.nebius.com` allowed) to run the live benchmark. The build session's policy denied those hosts.
- [ ] **Nebius AI Cloud credentials** (project id + service account) if the Serverless Jobs executor (P1) is to be built and tested.
- [ ] **Demo video** filmed per `docs/VIDEO.md`, uploaded public on YouTube, link in `SUBMISSION.md`.
- [ ] **Repo visibility**: make `mlsniperpro/counterexample` public before submission (MIT `LICENSE` is in place).
- [ ] **Devpost submission** and the written feedback form (paste from `docs/FEEDBACK.md`).
