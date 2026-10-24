# BUG: initialises the running sum to 0 instead of nums[0] before scanning nums[1:], so subarrays that extend the first element are lost ([1, 1] gives 1).
def solve(nums):
    best = nums[0]
    cur = 0
    for x in nums[1:]:
        cur = max(x, cur + x)
        best = max(best, cur)
    return best
