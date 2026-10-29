# BUG: Bellman-Ford runs n - 2 rounds instead of n - 1, so a shortest path that uses n - 1 edges listed in reverse order is not fully relaxed.
def solve(n, edges):
    INF = float("inf")
    d = [INF] * n
    d[0] = 0
    for _ in range(n - 2):
        for u, v, w in edges:
            if d[u] != INF and d[u] + w < d[v]:
                d[v] = d[u] + w
    return [None if x == INF else x for x in d]
