// BUG: on a repeat, left jumps to last[c] + 1 even when that is behind the current window, so the window can move backwards ("abba" gives 3).
function solve(s) {
  const last = new Map();
  let left = 0;
  let best = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (last.has(c)) left = last.get(c) + 1;
    last.set(c, i);
    best = Math.max(best, i - left + 1);
  }
  return best;
}
