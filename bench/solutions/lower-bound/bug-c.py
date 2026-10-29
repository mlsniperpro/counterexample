# BUG: returns as soon as it hits an element equal to the target, which is not necessarily the first one when values repeat.
def solve(nums, target):
    lo, hi = 0, len(nums)
    while lo < hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid
    return lo
