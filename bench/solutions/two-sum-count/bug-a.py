# BUG: records the current value before looking up its complement, so an element pairs with itself whenever 2 * x == target.
from collections import Counter


def solve(nums, target):
    seen = Counter()
    count = 0
    for x in nums:
        seen[x] += 1
        count += seen[target - x]
    return count
