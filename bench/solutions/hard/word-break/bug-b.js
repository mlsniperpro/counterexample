// BUG: memoises only successes, so every failing suffix is searched again: on "aaa...ab" with words ["a", "aa", "aaa"] it is as exponential as no memo at all and times out.
function solve(s, words) {
  const ok = new Set();
  const can = (i) => {
    if (i === s.length || ok.has(i)) return true;
    for (const w of words) {
      if (s.startsWith(w, i) && can(i + w.length)) {
        ok.add(i);
        return true;
      }
    }
    return false;
  };
  return can(0);
}
