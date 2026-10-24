// CORRECT: overflow-safe midpoint, upper bound capped at 46341.
function solve(x) {
  let lo = 0;
  let hi = Math.min(x, 46341);
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo + 1) / 2);
    if (mid * mid <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
