# BUG: uses `amount` itself as the "unreachable" sentinel, so an optimum that needs exactly `amount` coins (all ones) is reported as -1.
def solve(coins, amount):
    dp = [0] + [amount] * amount
    for a in range(1, amount + 1):
        for c in coins:
            if c <= a and dp[a - c] + 1 < dp[a]:
                dp[a] = dp[a - c] + 1
    return dp[amount] if dp[amount] < amount else (0 if amount == 0 else -1)
