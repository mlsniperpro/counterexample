# BUG: searches the closed range [0, len - 1], so it can never return len when the target is larger than every element.
def solve(nums, target):
    lo, hi = 0, max(0, len(nums) - 1)
    while lo < hi:
        mid = (lo + hi) // 2
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid
    return lo
