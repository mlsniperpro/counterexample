# BUG: uses INF = 10**9 as "unreachable", but a chain of hundreds of heavy edges is longer than 10^9, so far nodes are reported as null.
def solve(n, edges):
    INF = 10**9
    dist = [INF] * n
    dist[0] = 0
    for u, v, w in sorted(edges):
        if dist[u] < INF and dist[u] + w < dist[v]:
            dist[v] = dist[u] + w
    return [None if d >= INF else d for d in dist]
