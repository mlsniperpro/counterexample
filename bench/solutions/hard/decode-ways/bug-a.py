# BUG: recursion without memoisation explores every decoding one by one: a long run of 1s and 2s has Fibonacci-many decodings and times out.
MOD = 10**9 + 7


def solve(s):
    def ways(i):
        if i == len(s):
            return 1
        if s[i] == "0":
            return 0
        r = ways(i + 1)
        if i + 1 < len(s) and int(s[i:i + 2]) <= 26:
            r += ways(i + 2)
        return r % MOD

    return ways(0)
