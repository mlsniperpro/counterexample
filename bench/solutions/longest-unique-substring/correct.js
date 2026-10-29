// CORRECT: sliding window, left only moves forward.
function solve(s) {
  const last = new Map();
  let left = 0;
  let best = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (last.has(c)) left = Math.max(left, last.get(c) + 1);
    last.set(c, i);
    best = Math.max(best, i - left + 1);
  }
  return best;
}
