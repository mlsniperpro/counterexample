import fc from "fast-check";

// Property tests are reproducible: a fixed seed by default. Explore with FC_SEED=123, go deep with FC_NUM_RUNS=10000.
fc.configureGlobal({ seed: Number(process.env.FC_SEED ?? 20261024), numRuns: Number(process.env.FC_NUM_RUNS ?? 200) });
