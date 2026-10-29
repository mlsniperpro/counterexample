# CORRECT: memoised recursion over positions (functools.cache is unbounded), reduced modulo 10^9 + 7.
from functools import cache

MOD = 10**9 + 7


def solve(s):
    @cache
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
