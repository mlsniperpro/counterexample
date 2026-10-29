// BUG: on a repeat it clears the whole window and restarts at the current character, dropping valid characters between the two copies ("abac" gives 2).
function solve(s) {
  let seen = new Set();
  let best = 0;
  for (const c of s) {
    if (seen.has(c)) seen = new Set();
    seen.add(c);
    best = Math.max(best, seen.size);
  }
  return best;
}
