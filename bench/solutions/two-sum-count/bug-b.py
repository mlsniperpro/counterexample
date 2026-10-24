# BUG: two pointers move both ends after a match, which undercounts when values repeat ([1, 1, 1] with target 2 gives 1 instead of 3).
def solve(nums, target):
    a = sorted(nums)
    lo, hi = 0, len(a) - 1
    count = 0
    while lo < hi:
        s = a[lo] + a[hi]
        if s == target:
            count += 1
            lo += 1
            hi -= 1
        elif s < target:
            lo += 1
        else:
            hi -= 1
    return count
