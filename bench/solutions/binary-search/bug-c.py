# BUG: `lo = mid` without + 1 never makes progress when hi == lo + 1 and the target is at hi (or absent above), so it loops forever.
def solve(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid
        else:
            hi = mid - 1
    return -1
