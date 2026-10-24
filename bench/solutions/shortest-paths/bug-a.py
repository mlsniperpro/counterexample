# BUG: Dijkstra finalises a node when it is first popped, which is wrong once negative edges exist: a later negative edge can still shorten an already-final node.
import heapq

def solve(n, edges):
    adj = [[] for _ in range(n)]
    for u, v, w in edges:
        adj[u].append((v, w))
    dist = [None] * n
    heap = [(0, 0)]
    while heap:
        d, u = heapq.heappop(heap)
        if dist[u] is not None:
            continue
        dist[u] = d
        for v, w in adj[u]:
            if dist[v] is None:
                heapq.heappush(heap, (d + w, v))
    return dist
