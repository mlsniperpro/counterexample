Mode: **fixture** (replayed model responses; token counts estimated from text length, model latency simulated; execution is real). Executor: Local subprocess (dev only, not sandboxed).

| Metric | Routed (Ultra + Super) | Ultra only | Ablation: no model generators (1000 uniform random inputs) |
| --- | --- | --- | --- |
| Bugs found (of 30 buggy) | 30 (100%) | 30 (100%) | 27 (90%) |
| False alarms (of 10 correct) | 0 | 0 | 0 |
| Fixes verified by re-attack | 30 of 30 | 30 of 30 | 27 of 27 |
| Median time to first counterexample | 4.9 s | 10.3 s | 2.3 s |
| Model cost per solution | $0.0014 | $0.0027 | $0.0008 |
| Model cost, all 40 solutions | $0.0564 | $0.1088 | $0.0336 |
| Runs ending in error / budget / bad oracle | 0 | 0 | 0 |

| Solution | Expected | Verdict (routed) | Minimal counterexample | Fix verified |
| --- | --- | --- | --- | --- |
| `binary-search/bug-a` | bug | counterexample | `[[0],0]` | yes |
| `binary-search/bug-b` | bug | counterexample | `[[1,2],1]` | yes |
| `binary-search/bug-c` | bug | counterexample | `[[0],1]` | yes |
| `binary-search/correct` | correct | no_counterexample |  |  |
| `coin-change/bug-a` | bug | counterexample | `[[2,3],4]` | yes |
| `coin-change/bug-b` | bug | counterexample | `[[1],1]` | yes |
| `coin-change/bug-c` | bug | counterexample | `[[1],2]` | yes |
| `coin-change/correct` | correct | no_counterexample |  |  |
| `isqrt/bug-a` | bug | counterexample | `[2147483647]` | yes |
| `isqrt/bug-b` | bug | counterexample | `[0]` | yes |
| `isqrt/bug-c` | bug | counterexample | `[3]` | yes |
| `isqrt/correct` | correct | no_counterexample |  |  |
| `longest-unique-substring/bug-a` | bug | counterexample | `["baab"]` | yes |
| `longest-unique-substring/bug-b` | bug | counterexample | `["babc"]` | yes |
| `longest-unique-substring/bug-c` | bug | counterexample | `["a"]` | yes |
| `longest-unique-substring/correct` | correct | no_counterexample |  |  |
| `lower-bound/bug-a` | bug | counterexample | `[[0],1]` | yes |
| `lower-bound/bug-b` | bug | counterexample | `[[0],0]` | yes |
| `lower-bound/bug-c` | bug | counterexample | `[[0,0],0]` | yes |
| `lower-bound/correct` | correct | no_counterexample |  |  |
| `max-subarray/bug-a` | bug | counterexample | `[[-1]]` | yes |
| `max-subarray/bug-b` | bug | counterexample | `[[1,1]]` | yes |
| `max-subarray/bug-c` | bug | counterexample | `[[-1,-1]]` | yes |
| `max-subarray/correct` | correct | no_counterexample |  |  |
| `merge-intervals/bug-a` | bug | counterexample | `[[[0,4],[4,4]]]` | yes |
| `merge-intervals/bug-b` | bug | counterexample | `[[[2,2],[10,10]]]` | yes |
| `merge-intervals/bug-c` | bug | counterexample | `[[[0,2],[1,1]]]` | yes |
| `merge-intervals/correct` | correct | no_counterexample |  |  |
| `shortest-paths/bug-a` | bug | counterexample | `[3,[[0,1,1],[1,2,-2],[0,2,0]]]` | yes |
| `shortest-paths/bug-b` | bug | counterexample | `[2,[[0,1,0]]]` | yes |
| `shortest-paths/bug-c` | bug | counterexample | `[3,[[1,2,-1]]]` | yes |
| `shortest-paths/correct` | correct | no_counterexample |  |  |
| `two-sum-count/bug-a` | bug | counterexample | `[[0],0]` | yes |
| `two-sum-count/bug-b` | bug | counterexample | `[[0,0,0],0]` | yes |
| `two-sum-count/bug-c` | bug | counterexample | `[[0,0],0]` | yes |
| `two-sum-count/correct` | correct | no_counterexample |  |  |
| `valid-parentheses/bug-a` | bug | counterexample | `["({())}"]` | yes |
| `valid-parentheses/bug-b` | bug | counterexample | `["("]` | yes |
| `valid-parentheses/bug-c` | bug | counterexample | `[")"]` | yes |
| `valid-parentheses/correct` | correct | no_counterexample |  |  |
