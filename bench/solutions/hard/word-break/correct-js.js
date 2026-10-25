// CORRECT: memoised search over start positions, caching failures as well as successes.
function solve(s, words) {
  const memo = new Map();
  const can = (i) => {
    if (i === s.length) return true;
    if (memo.has(i)) return memo.get(i);
    let r = false;
    for (const w of words) {
      if (s.startsWith(w, i) && can(i + w.length)) {
        r = true;
        break;
      }
    }
    memo.set(i, r);
    return r;
  };
  return can(0);
}
