# BUG: counts pairs of equal values as c * c // 2 instead of c * (c - 1) // 2 ([1, 1] with target 2 gives 2).
from collections import Counter


def solve(nums, target):
    cnt = Counter(nums)
    count = 0
    for x in cnt:
        y = target - x
        if x < y:
            count += cnt[x] * cnt[y]
        elif x == y:
            count += cnt[x] * cnt[x] // 2
    return count
