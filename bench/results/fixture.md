Mode: **fixture** (replayed hand-written stand-ins for model answers; token counts estimated from text length, model latency simulated; execution is real). In fixture mode, each benchmark "fix" is the problem's correct reference solution, so "Fixes verified" is a pipeline check, not fix quality. Executor: Local subprocess (dev only, not sandboxed).

| Metric | Routed (Ultra + Super) | Ultra only | Ablation: no model families (examples, small-scope, mutations, random) | Ablation: examples + 1000 uniform random inputs only |
| --- | --- | --- | --- | --- |
| Bugs found (of 38 buggy) | 38 (100%) | 38 (100%) | 30 (79%) | 27 (71%) |
| False alarms (of 16 correct) | 0 | 0 | 0 | 0 |
| Fixes verified by re-attack | 38 of 38 | 38 of 38 | 30 of 30 | 27 of 27 |
| Bugs first found by a model-designed family | 13 | 13 | 0 | 0 |
| Median time to first counterexample (execution plus simulated model latency; varies by about ±0.5 s run to run, more on a loaded machine) | 5.6 s | 11.4 s | 2.7 s | 2.6 s |
| Model cost per solution | $0.0016 | $0.0032 | $0.0008 | $0.0008 |
| Model cost, all 54 solutions | $0.0882 | $0.1725 | $0.0433 | $0.0419 |
| Runs ending in error / budget / bad oracle | 0 | 0 | 0 | 0 |

**Base tier only** (`bench/solutions/<problem>/`: 30 buggy, 10 correct; same budgets and seeds as above):

| Metric | Routed (Ultra + Super) | Ablation: no model families (examples, small-scope, mutations, random) | Ablation: examples + 1000 uniform random inputs only |
| --- | --- | --- | --- |
| Bugs found (of 30 buggy) | 30 (100%) | 30 (100%) | 27 (90%) |
| False alarms (of 10 correct) | 0 | 0 | 0 |
| Fixes verified by re-attack | 30 of 30 | 30 of 30 | 27 of 27 |
| Bugs first found by a model-designed family | 5 | 0 | 0 |
| Runs ending in error / budget / bad oracle | 0 | 0 | 0 |

**Hard tier only** (`bench/solutions/hard/<problem>/`: 8 buggy, 6 correct; same budgets and seeds as above):

| Metric | Routed (Ultra + Super) | Ablation: no model families (examples, small-scope, mutations, random) | Ablation: examples + 1000 uniform random inputs only |
| --- | --- | --- | --- |
| Bugs found (of 8 buggy) | 8 (100%) | 0 (0%) | 0 (0%) |
| False alarms (of 6 correct) | 0 | 0 | 0 |
| Fixes verified by re-attack | 8 of 8 | 0 of 0 | 0 of 0 |
| Bugs first found by a model-designed family | 8 | 0 | 0 |
| Runs ending in error / budget / bad oracle | 0 | 0 | 0 |

Load per attack (routed): 2 to 4 (median 3) model calls and 1,179 to 5,381 (median 2,635.5) sandbox runs, which is at least 31 to 385 (median 57) Judge0 submissions (up to 64 inputs each, fewer when a long time limit would not fit Judge0's 15 s CPU cap; smaller shrink batches, timeouts and crashes add more).

| Solution | Tier | Expected | Verdict (routed) | Found by family | Minimal counterexample | Fix verified |
| --- | --- | --- | --- | --- | --- | --- |
| `binary-search/bug-a` | base | bug | counterexample | small-scope | `[[0],0]` | yes |
| `binary-search/bug-b` | base | bug | counterexample | examples | `[[1,2],1]` | yes |
| `binary-search/bug-c` | base | bug | counterexample | examples | `[[0],1]` | yes |
| `binary-search/correct` | base | correct | no_counterexample |  |  |  |
| `coin-change/bug-a` | base | bug | counterexample | small-scope | `[[2,5],6]` | yes |
| `coin-change/bug-b` | base | bug | counterexample | small-scope | `[[1],1]` | yes |
| `coin-change/bug-c` | base | bug | counterexample | examples | `[[1],2]` | yes |
| `coin-change/correct` | base | correct | no_counterexample |  |  |  |
| `isqrt/bug-a` | base | bug | counterexample | small-scope | `[2147483647]` | yes |
| `isqrt/bug-b` | base | bug | counterexample | small-scope | `[0]` | yes |
| `isqrt/bug-c` | base | bug | counterexample | examples | `[3]` | yes |
| `isqrt/correct` | base | correct | no_counterexample |  |  |  |
| `longest-unique-substring/bug-a` | base | bug | counterexample | two-letter-alphabet (model) | `["baab"]` | yes |
| `longest-unique-substring/bug-b` | base | bug | counterexample | duplicate-heavy (model) | `["babc"]` | yes |
| `longest-unique-substring/bug-c` | base | bug | counterexample | small-scope | `["a"]` | yes |
| `longest-unique-substring/correct` | base | correct | no_counterexample |  |  |  |
| `lower-bound/bug-a` | base | bug | counterexample | small-scope | `[[0],1]` | yes |
| `lower-bound/bug-b` | base | bug | counterexample | small-scope | `[[1],1]` | yes |
| `lower-bound/bug-c` | base | bug | counterexample | small-scope | `[[-1,-1],-1]` | yes |
| `lower-bound/correct` | base | correct | no_counterexample |  |  |  |
| `max-subarray/bug-a` | base | bug | counterexample | small-scope | `[[-1]]` | yes |
| `max-subarray/bug-b` | base | bug | counterexample | examples | `[[1,1]]` | yes |
| `max-subarray/bug-c` | base | bug | counterexample | small-scope | `[[-1,-1]]` | yes |
| `max-subarray/correct` | base | correct | no_counterexample |  |  |  |
| `merge-intervals/bug-a` | base | bug | counterexample | examples | `[[[0,4],[4,4]]]` | yes |
| `merge-intervals/bug-b` | base | bug | counterexample | examples | `[[[2,2],[10,10]]]` | yes |
| `merge-intervals/bug-c` | base | bug | counterexample | touching (model) | `[[[0,2],[1,1]]]` | yes |
| `merge-intervals/correct` | base | correct | no_counterexample |  |  |  |
| `shortest-paths/bug-a` | base | bug | counterexample | negative-shortcut (model) | `[3,[[0,1,1],[1,2,-2],[0,2,0]]]` | yes |
| `shortest-paths/bug-b` | base | bug | counterexample | small-scope | `[2,[[0,1,0]]]` | yes |
| `shortest-paths/bug-c` | base | bug | counterexample | small-scope | `[3,[[1,2,-1]]]` | yes |
| `shortest-paths/correct` | base | correct | no_counterexample |  |  |  |
| `two-sum-count/bug-a` | base | bug | counterexample | small-scope | `[[1],2]` | yes |
| `two-sum-count/bug-b` | base | bug | counterexample | small-scope | `[[0,0,-1],-1]` | yes |
| `two-sum-count/bug-c` | base | bug | counterexample | small-scope | `[[-1,-1],-2]` | yes |
| `two-sum-count/correct` | base | correct | no_counterexample |  |  |  |
| `valid-parentheses/bug-a` | base | bug | counterexample | full-alphabet (model) | `["({)}"]` | yes |
| `valid-parentheses/bug-b` | base | bug | counterexample | small-scope | `["("]` | yes |
| `valid-parentheses/bug-c` | base | bug | counterexample | small-scope | `[")"]` | yes |
| `valid-parentheses/correct` | base | correct | no_counterexample |  |  |  |
| `hard/dag-distances/bug-a` | hard | bug | counterexample | path-graph-max-n (model) | `[215,[[0,1,0],[0,2,8277862],[2,3,1895036],[3,4,9459078],[4,5` (not minimal) | yes |
| `hard/dag-distances/bug-b` | hard | bug | counterexample | path-graph-max-n (model) | `[460,[[0,1,0],[1,2,8277862],[2,3,1895036],[3,4,9459078],[4,5` (not minimal) | yes |
| `hard/dag-distances/correct-js` | hard | correct | no_counterexample |  |  |  |
| `hard/dag-distances/correct-py` | hard | correct | no_counterexample |  |  |  |
| `hard/decode-ways/bug-a` | hard | bug | counterexample | all-ones-max-length (model) | `["1111111111111111111111111111111"]` | yes |
| `hard/decode-ways/bug-b` | hard | bug | counterexample | ambiguous-run-dead-end (model) | `["111111111111111111111111111111111100"]` | yes |
| `hard/decode-ways/bug-c` | hard | bug | counterexample | all-ones-max-length (model) | `["2222222222222222222222222222222222222222222222222222222222` | yes |
| `hard/decode-ways/correct-js` | hard | correct | no_counterexample |  |  |  |
| `hard/decode-ways/correct-py` | hard | correct | no_counterexample |  |  |  |
| `hard/word-break/bug-a` | hard | bug | counterexample | one-letter-run-no-split (model) | `["aaaaaaaaaaaaaaaaaaaaaaaab",["aaa","aa","a"]]` | yes |
| `hard/word-break/bug-b` | hard | bug | counterexample | one-letter-run-no-split (model) | `["aaaaaaaaaaaaaaaaaaaaaaaaaaab",["aaa","aa","a"]]` | yes |
| `hard/word-break/bug-c` | hard | bug | counterexample | one-letter-run-no-split (model) | `["aaaaaaaaaaaaaaaaaaaaaaaaaaab",["aaa","aa","a"]]` | yes |
| `hard/word-break/correct-js` | hard | correct | no_counterexample |  |  |  |
| `hard/word-break/correct-py` | hard | correct | no_counterexample |  |  |  |
