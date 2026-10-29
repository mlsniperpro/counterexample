// BUG: searches for the first mid with mid*mid > x but starts with hi = x instead of x + 1, so x = 0 gives -1 and x = 1 gives 0.
function solve(x) {
  let lo = 0;
  let hi = x;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid * mid <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}
