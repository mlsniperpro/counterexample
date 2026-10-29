// BUG: rounds the floating-point square root instead of flooring it, so x = 3 gives 2.
function solve(x) {
  return Math.round(Math.sqrt(x));
}
