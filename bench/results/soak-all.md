Soak run: 1071 attacks on 357 mutants (of all 40 benchmark solutions), 3 seed(s), replay mode, local executor, 1023 s.

| Outcome | Count | Meaning |
| --- | --- | --- |
| killed | 1017 | counterexample reported **and independently confirmed** against the reference solution |
| unsound | 0 | counterexample reported but not real (must be 0) |
| survived | 54 | no counterexample, and a 3,000-input independent differential search found none either (likely equivalent mutant) |
| missed | 0 | no counterexample, but the independent search found a difference (a real miss) |
| error | 0 | the attack ended in error or budget exhaustion |
