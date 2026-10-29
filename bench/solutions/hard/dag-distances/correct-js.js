// CORRECT: relaxes edges in order of their source node (a topological order, since u < v) with plain numbers, exact up to 2^53.
function solve(n, edges) {
  const dist = new Array(n).fill(null);
  dist[0] = 0;
  const order = edges.slice().sort((a, b) => a[0] - b[0]);
  for (const [u, v, w] of order) {
    if (dist[u] !== null && (dist[v] === null || dist[u] + w < dist[v])) dist[v] = dist[u] + w;
  }
  return dist;
}
