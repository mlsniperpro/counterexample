// BUG: stores distances in an Int32Array, so a distance past 2^31 - 1 (a long chain of heavy edges) wraps around to a negative number.
function solve(n, edges) {
  const INF = 2147483647;
  const dist = new Int32Array(n).fill(INF);
  dist[0] = 0;
  const order = edges.slice().sort((a, b) => a[0] - b[0]);
  for (const [u, v, w] of order) {
    if (dist[u] !== INF && dist[u] + w < dist[v]) dist[v] = dist[u] + w;
  }
  return Array.from(dist, (d) => (d === INF ? null : d));
}
