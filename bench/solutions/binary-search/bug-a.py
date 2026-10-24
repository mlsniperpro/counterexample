# BUG: loop condition `lo < hi` exits before checking the last candidate, so a target at the final remaining position (e.g. a one-element array) returns -1.
def solve(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
