# BUG: moves right on nums[mid] <= target, which computes the upper bound, so the result is past any elements equal to the target.
def solve(nums, target):
    lo, hi = 0, len(nums)
    while lo < hi:
        mid = (lo + hi) // 2
        if nums[mid] <= target:
            lo = mid + 1
        else:
            hi = mid
    return lo
