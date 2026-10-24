// BUG: only records the window length when a repeat is found, so the window that runs to the end of the string is never counted ("a" gives 0).
function solve(s) {
  const last = new Map();
  let left = 0;
  let best = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (last.has(c) && last.get(c) >= left) {
      best = Math.max(best, i - left);
      left = last.get(c) + 1;
    }
    last.set(c, i);
  }
  return best;
}
