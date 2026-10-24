import fc from "fast-check";

// Property tests are reproducible: a fixed seed by default, overridable to explore (FC_SEED=123 pnpm test).
fc.configureGlobal({ seed: Number(process.env.FC_SEED ?? 20261024), numRuns: 200 });
