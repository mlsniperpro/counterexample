// BUG: applies the modulus only to the final answer; the counts grow like Fibonacci numbers and pass 2^53 after about 78 ambiguous digits, so a long run of 1s loses precision.
function solve(s) {
  const n = s.length;
  const dp = new Array(n + 2).fill(0);
  dp[n] = 1;
  for (let i = n - 1; i >= 0; i--) {
    if (s[i] === "0") continue;
    dp[i] = dp[i + 1];
    if (i + 1 < n && Number(s.slice(i, i + 2)) <= 26) dp[i] += dp[i + 2];
  }
  return dp[0] % 1000000007;
}
