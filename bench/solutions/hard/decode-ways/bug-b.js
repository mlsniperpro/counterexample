// BUG: `if (memo[i]) return memo[i]` treats a cached 0 as missing, so suffixes with no decoding are recomputed: a long run of 1s and 2s followed by "00" takes exponential time.
function solve(s) {
  const MOD = 1000000007;
  const memo = [];
  const ways = (i) => {
    if (i === s.length) return 1;
    if (memo[i]) return memo[i];
    let r = 0;
    if (s[i] !== "0") {
      r = ways(i + 1);
      if (i + 1 < s.length && Number(s.slice(i, i + 2)) <= 26) r = (r + ways(i + 2)) % MOD;
    }
    memo[i] = r;
    return r;
  };
  return ways(0);
}
