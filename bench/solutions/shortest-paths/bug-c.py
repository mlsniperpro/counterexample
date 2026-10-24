# BUG: uses 10**9 as "infinity" and relaxes from unreachable nodes too, so a negative edge out of an unreachable node makes its target look reachable (10**9 - w < 10**9).
def solve(n, edges):
    INF = 10**9
    d = [INF] * n
    d[0] = 0
    for _ in range(n):
        for u, v, w in edges:
            if d[u] + w < d[v]:
                d[v] = d[u] + w
    return [None if x >= INF else x for x in d]
