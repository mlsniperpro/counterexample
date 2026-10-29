# BUG: plain backtracking without memoisation retries every split of a long run of one letter: s = "aaa...ab" with words ["a", "aa", "aaa"] takes exponential time and times out.
def solve(s, words):
    def can(i):
        if i == len(s):
            return True
        for w in words:
            if s.startswith(w, i) and can(i + len(w)):
                return True
        return False

    return can(0)
