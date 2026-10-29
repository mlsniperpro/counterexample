# BUG: max prefix minus min prefix ignores that the minimum must come before the maximum ([3, -5] gives 5).
def solve(nums):
    prefix = [0]
    for x in nums:
        prefix.append(prefix[-1] + x)
    return max(prefix[1:]) - min(prefix[:-1])
