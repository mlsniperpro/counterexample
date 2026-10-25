# CORRECT: every edge has u < v, so nodes in increasing order are a topological order; one pass over the edges sorted by source is exact.
def solve(n, edges):
    dist = [None] * n
    dist[0] = 0
    for u, v, w in sorted(edges):
        if dist[u] is not None and (dist[v] is None or dist[u] + w < dist[v]):
            dist[v] = dist[u] + w
    return dist
