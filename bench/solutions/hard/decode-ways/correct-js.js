// CORRECT: bottom-up dynamic programming, reduced modulo 10^9 + 7 at every step.
function solve(s) {
  const MOD = 1000000007;
  const n = s.length;
  const dp = new Array(n + 2).fill(0);
  dp[n] = 1;
  for (let i = n - 1; i >= 0; i--) {
    if (s[i] === "0") continue;
    dp[i] = dp[i + 1];
    if (i + 1 < n && Number(s.slice(i, i + 2)) <= 26) dp[i] = (dp[i] + dp[i + 2]) % MOD;
  }
  return dp[0];
}
