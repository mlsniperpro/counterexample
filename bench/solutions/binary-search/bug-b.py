# BUG: mixes a half-open range (hi = len) with the closed-range update hi = mid - 1, so index mid - 1 is skipped when the target is just left of mid.
def solve(nums, target):
    lo, hi = 0, len(nums)
    while lo < hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
