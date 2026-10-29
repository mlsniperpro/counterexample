// BUG: Array.prototype.sort() without a comparator sorts the pairs as strings, so [10, 12] comes before [2, 3] and the sweep merges in the wrong order.
function solve(intervals) {
  const xs = intervals.map((x) => [...x]).sort();
  const out = [];
  for (const cur of xs) {
    const last = out[out.length - 1];
    if (last && cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1]);
    else out.push(cur);
  }
  return out;
}
