# CORRECT: every edge goes from a lower to a higher node, so relaxing edges in order of their source is a topological-order DP.
def solve(n, edges):
    d = [None] * n
    d[0] = 0
    for u, v, w in sorted(edges):
        if d[u] is not None and (d[v] is None or d[u] + w < d[v]):
            d[v] = d[u] + w
    return d
