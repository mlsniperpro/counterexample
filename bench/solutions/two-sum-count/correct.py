# CORRECT: count complements seen so far.
from collections import Counter

def solve(nums, target):
    seen = Counter()
    count = 0
    for x in nums:
        count += seen[target - x]
        seen[x] += 1
    return count
