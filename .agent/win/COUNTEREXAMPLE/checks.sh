#!/usr/bin/env bash
# Every check for the Counterexample entry, in the order a judge would run them.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Lint (zero warnings), Python lint of the benchmark subjects, strict typecheck.
pnpm lint
ruff check bench/solutions
pnpm typecheck

# Unit, property, integration and replay end-to-end tests (fixed fast-check seed).
pnpm test

# Property tests again at a higher example count.
FC_NUM_RUNS=1000 pnpm exec vitest run tests/unit --testTimeout 600000

# Replay end to end through the benchmark CLI on one problem (real execution, recorded model answers).
pnpm bench --only binary-search

# Production build.
pnpm build

# Browser smoke test of the UI wiring (attack, cancel, share link, 390 px) against that build.
pnpm e2e
