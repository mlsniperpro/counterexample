# BUG: a regex alternation of the words backtracks catastrophically: matching "aaa...ab" against (?:a|aa|aaa)* tries exponentially many splits before failing and times out.
import re


def solve(s, words):
    return re.fullmatch("(?:" + "|".join(map(re.escape, words)) + ")*", s) is not None
