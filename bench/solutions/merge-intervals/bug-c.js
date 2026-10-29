// BUG: overwrites the merged end with the current end instead of taking the max, so a nested interval ([1, 10] then [2, 3]) shrinks the merged one.
function solve(intervals) {
  const xs = intervals.map((x) => [...x]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const cur of xs) {
    const last = out[out.length - 1];
    if (last && cur[0] <= last[1]) last[1] = cur[1];
    else out.push(cur);
  }
  return out;
}
