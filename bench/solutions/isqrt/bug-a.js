// BUG: the midpoint (lo + hi + 1) >> 1 overflows 32-bit signed arithmetic when x = 2^31 - 1, mid goes negative and the search returns 0.
function solve(x) {
  let lo = 0;
  let hi = x;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (mid * mid <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
