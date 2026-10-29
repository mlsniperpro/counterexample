# CORRECT: dynamic programming over prefixes: ok[i] is true when s[:i] splits into words.
def solve(s, words):
    ok = [True] + [False] * len(s)
    for i in range(1, len(s) + 1):
        ok[i] = any(len(w) <= i and ok[i - len(w)] and s.startswith(w, i - len(w)) for w in words)
    return ok[len(s)]
