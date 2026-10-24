# BUG: greedy largest-coin-first is not optimal for arbitrary coin systems (coins [1, 3, 4], amount 6 gives 3 instead of 2) and can miss reachable amounts entirely.
def solve(coins, amount):
    count = 0
    for c in sorted(coins, reverse=True):
        take = amount // c
        count += take
        amount -= take * c
    return count if amount == 0 else -1
