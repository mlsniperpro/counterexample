// BUG: merges only on strict overlap (start < end), so touching intervals such as [1, 2] and [2, 3] stay separate.
function solve(intervals) {
  const xs = intervals.map((x) => [...x]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const cur of xs) {
    const last = out[out.length - 1];
    if (last && cur[0] < last[1]) last[1] = Math.max(last[1], cur[1]);
    else out.push(cur);
  }
  return out;
}
