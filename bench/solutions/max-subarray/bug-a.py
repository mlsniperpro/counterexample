# BUG: starts the best sum at 0, which is the empty subarray, so an all-negative array returns 0 instead of its largest element.
def solve(nums):
    best = 0
    cur = 0
    for x in nums:
        cur = max(x, cur + x)
        best = max(best, cur)
    return best
