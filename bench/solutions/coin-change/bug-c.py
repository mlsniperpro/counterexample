# BUG: iterates amounts downwards inside the coin loop (0/1 knapsack), so each coin can be used at most once.
def solve(coins, amount):
    INF = float("inf")
    dp = [0] + [INF] * amount
    for c in coins:
        for a in range(amount, c - 1, -1):
            dp[a] = min(dp[a], dp[a - c] + 1)
    return -1 if dp[amount] == INF else dp[amount]
