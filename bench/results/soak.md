Soak run: 97 attacks on 97 mutants (of the 10 correct solutions), 1 seed(s), replay mode, local executor, 53 s.

| Outcome | Count | Meaning |
| --- | --- | --- |
| killed | 88 | counterexample reported **and independently confirmed** against the reference solution |
| unsound | 0 | counterexample reported but not real (must be 0) |
| survived | 9 | no counterexample, and a 3,000-input independent differential search found none either (likely equivalent mutant) |
| missed | 0 | no counterexample, but the independent search found a difference (a real miss) |
| error | 0 | the attack ended in error or budget exhaustion |
