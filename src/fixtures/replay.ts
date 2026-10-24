/**
 * Deterministic replay fixtures: hand-written responses in the shape the
 * models are prompted to produce (fenced code, JSON), so the real parsers run.
 * Replace or extend them with real recordings from `pnpm bench --live --record`.
 */
import type { ReplayFixtures } from "../lib/models/replay";
import type { SearchResult } from "../lib/research/tavily";

const py = (s: string) => "```python\n" + s.trim() + "\n```";
const json = (o: unknown) => "```json\n" + JSON.stringify(o, null, 2) + "\n```";

export const LEETCODE_704 = "https://leetcode.com/problems/binary-search/description/";
export const BS_EDGE_DISCUSS = "https://en.wikipedia.org/wiki/Binary_search_algorithm#Implementation_issues";

export const RESEARCH_RESULTS: Record<string, SearchResult[]> = {
  "LeetCode 704 Binary Search official constraints": [
    {
      title: "Binary Search - LeetCode",
      url: LEETCODE_704,
      content:
        "Given an array of integers nums which is sorted in ascending order, and an integer target, write a function to search target in nums. If target exists, then return its index. Otherwise, return -1. Constraints: 1 <= nums.length <= 10^4; -10^4 < nums[i], target < 10^4; All the integers in nums are unique; nums is sorted in ascending order.",
    },
    {
      title: "Binary search algorithm - Implementation issues",
      url: BS_EDGE_DISCUSS,
      content:
        "Although the basic idea of binary search is comparatively straightforward, the details can be surprisingly tricky... off-by-one errors in the loop condition and the update of the bounds are common; when the remaining range has one element the loop must still compare it.",
    },
  ],
};

export const FIXTURES: ReplayFixtures = {
  "binary-search": {
    research: json({
      facts: [
        { fact: "nums has at least 1 element (1 <= nums.length <= 10^4), so one-element arrays are legal and important.", url: LEETCODE_704 },
        { fact: "All integers in nums are unique and sorted ascending; values and target lie strictly inside (-10^4, 10^4).", url: LEETCODE_704 },
        { fact: "Off-by-one errors in the loop condition skip the last remaining element; test targets at both ends and in one-element ranges.", url: BS_EDGE_DISCUSS },
      ],
    }),
    oracle: "A linear scan is trivially correct.\n\n" + py(`
def solve(nums, target):
    for i, x in enumerate(nums):
        if x == target:
            return i
    return -1`),
    generators: json({
      families: [
        {
          name: "single-element",
          rationale: "LeetCode allows length 1; a loop that exits when lo == hi never compares the only element.",
          count: 200,
          args: [
            { kind: "array", of: { kind: "int", min: -9999, max: 9999, bias: "edges" }, len: { min: 1, max: 1 }, sorted: "asc", distinct: true },
            { kind: "int", min: -9999, max: 9999, bias: "edges" },
          ],
          citations: [LEETCODE_704, BS_EDGE_DISCUSS],
        },
        {
          name: "target-at-ends",
          rationale: "Targets equal to the first or last element exercise both bound updates.",
          count: 300,
          args: [
            { kind: "array", of: { kind: "int", min: -20, max: 20 }, len: { min: 1, max: 8 }, sorted: "asc", distinct: true },
            { kind: "int", min: -20, max: 20, bias: "edges" },
          ],
          citations: [BS_EDGE_DISCUSS],
        },
        {
          name: "dense-small",
          rationale: "Small dense arrays where every target value is present or adjacent.",
          count: 300,
          args: [
            { kind: "array", of: { kind: "int", min: 0, max: 12 }, len: { min: 1, max: 12 }, sorted: "asc", distinct: true },
            { kind: "int", min: -1, max: 13 },
          ],
        },
        {
          name: "large-sizes",
          rationale: "Long arrays to reach deep iterations of the loop.",
          count: 100,
          args: [
            { kind: "array", of: { kind: "int", min: -9999, max: 9999 }, len: { min: 30, max: 40 }, sorted: "asc", distinct: true },
            { kind: "int", min: -9999, max: 9999 },
          ],
        },
      ],
    }),
    explain:
      "EXPLANATION: The loop runs only while lo < hi, so when the search narrows to a single index it exits without comparing nums[lo] to the target. On the counterexample the target sits at the last remaining position and the function returns -1 instead of its index.\n\n" +
      py(`
def solve(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1`),
  },

  isqrt: {
    oracle: "math.isqrt is exact for arbitrary-precision integers.\n\n" + py(`
import math

def solve(x):
    return math.isqrt(x)`),
    generators: json({
      families: [
        {
          name: "int32-bounds",
          rationale: "Values at and near 2^31 - 1 overflow a 32-bit midpoint such as (lo + hi + 1) >> 1.",
          count: 200,
          args: [{ kind: "int", min: 2147395600, max: 2147483647, bias: "edges" }],
        },
        {
          name: "tiny",
          rationale: "0, 1, 2, 3 break wrong initial bounds and rounding.",
          count: 50,
          args: [{ kind: "int", min: 0, max: 20, bias: "edges" }],
        },
        {
          name: "perfect-squares-neighbourhood",
          rationale: "Values just below a perfect square catch rounding instead of flooring.",
          count: 300,
          args: [{ kind: "int", min: 0, max: 10000 }],
        },
        {
          name: "random-large",
          rationale: "Uniform large values for general coverage.",
          count: 200,
          args: [{ kind: "int", min: 1000000, max: 2147483647 }],
        },
      ],
    }),
    explain:
      "EXPLANATION: The midpoint (lo + hi + 1) >> 1 is computed in 32-bit signed arithmetic, so for x = 2147483647 the sum reaches 2^31 and wraps to a negative mid. The negative mid fails the mid * mid <= x test, hi drops below lo and the search returns 0 instead of 46340.\n\n" +
      "```javascript\nfunction solve(x) {\n  let lo = 0;\n  let hi = Math.min(x, 46341);\n  while (lo < hi) {\n    const mid = lo + Math.floor((hi - lo + 1) / 2);\n    if (mid * mid <= x) lo = mid;\n    else hi = mid - 1;\n  }\n  return lo;\n}\n```",
  },

  "coin-change": {
    oracle: "Exhaustive recursion with memoisation over the remaining amount.\n\n" + py(`
from functools import lru_cache

def solve(coins, amount):
    @lru_cache(maxsize=None)
    def best(a):
        if a == 0:
            return 0
        r = float("inf")
        for c in coins:
            if c <= a:
                r = min(r, 1 + best(a - c))
        return r
    r = best(amount)
    return -1 if r == float("inf") else r`),
    generators: json({
      families: [
        {
          name: "non-canonical-systems",
          rationale: "Small coin sets without the greedy-choice property, e.g. [1, 3, 4].",
          count: 300,
          args: [
            { kind: "array", of: { kind: "int", min: 1, max: 9 }, len: { min: 2, max: 4 }, distinct: true },
            { kind: "int", min: 0, max: 30 },
          ],
        },
        {
          name: "no-unit-coin",
          rationale: "Without a 1-coin some amounts are unreachable and greedy can strand a remainder.",
          count: 300,
          args: [
            { kind: "array", of: { kind: "int", min: 2, max: 12 }, len: { min: 1, max: 4 }, distinct: true },
            { kind: "int", min: 0, max: 60 },
          ],
        },
        {
          name: "only-ones",
          rationale: "The answer equals the amount itself, which collides with sentinel values.",
          count: 60,
          args: [{ kind: "const", value: [1] }, { kind: "int", min: 0, max: 60, bias: "edges" }],
        },
        {
          name: "amount-bounds",
          rationale: "Amounts 0, 1 and the maximum.",
          count: 100,
          args: [
            { kind: "array", of: { kind: "int", min: 1, max: 20 }, len: { min: 1, max: 5 }, distinct: true },
            { kind: "int", min: 0, max: 60, bias: "edges" },
          ],
        },
      ],
    }),
    explain:
      "EXPLANATION: Taking the largest coin first is only optimal for canonical coin systems, and this coin set is not one. On the counterexample greedy either uses more coins than necessary or strands a remainder it cannot pay, while a combination of smaller coins works.\n\n" +
      py(`
def solve(coins, amount):
    INF = float("inf")
    dp = [0] + [INF] * amount
    for a in range(1, amount + 1):
        for c in coins:
            if c <= a and dp[a - c] + 1 < dp[a]:
                dp[a] = dp[a - c] + 1
    return -1 if dp[amount] == INF else dp[amount]`),
  },

  "shortest-paths": {
    oracle: "Bellman-Ford with n rounds; there are no cycles, so this is exact even with negative weights.\n\n" + py(`
def solve(n, edges):
    INF = float("inf")
    d = [INF] * n
    d[0] = 0
    for _ in range(n):
        for u, v, w in edges:
            if d[u] != INF and d[u] + w < d[v]:
                d[v] = d[u] + w
    return [None if x == INF else x for x in d]`),
    generators: json({
      families: [
        {
          name: "negative-shortcut",
          rationale: "A detour through a negative edge beats a direct edge that a greedy algorithm finalises first.",
          count: 300,
          args: [{ kind: "graph", n: { min: 3, max: 5 }, m: { min: 3, max: 8 }, weight: { min: -5, max: 6 }, dag: true }],
        },
        {
          name: "long-chains",
          rationale: "Paths with n - 1 edges need every relaxation round.",
          count: 200,
          args: [{ kind: "graph", n: { min: 5, max: 7 }, m: { min: 6, max: 14 }, weight: { min: -5, max: 10 }, dag: true }],
        },
        {
          name: "disconnected",
          rationale: "Unreachable nodes, including ones with negative out-edges, must stay null.",
          count: 200,
          args: [{ kind: "graph", n: { min: 2, max: 6 }, m: { min: 0, max: 3 }, weight: { min: -5, max: 10 }, dag: true }],
        },
      ],
    }),
    explain:
      "EXPLANATION: Dijkstra finalises a node the first time it is popped, which assumes no later path can be shorter; a negative edge breaks that assumption. On the counterexample a node is finalised through its direct edge before a cheaper path through a negative edge is discovered.\n\n" +
      py(`
def solve(n, edges):
    d = [None] * n
    d[0] = 0
    # Every edge goes from a lower to a higher node, so source order is a topological order.
    for u, v, w in sorted(edges):
        if d[u] is not None and (d[v] is None or d[u] + w < d[v]):
            d[v] = d[u] + w
    return d`),
  },

  "longest-unique-substring": {
    oracle: "Check every substring.\n\n" + py(`
def solve(s):
    best = 0
    for i in range(len(s)):
        for j in range(i, len(s)):
            sub = s[i:j + 1]
            if len(set(sub)) == len(sub):
                best = max(best, len(sub))
    return best`),
    generators: json({
      families: [
        {
          name: "two-letter-alphabet",
          rationale: "Patterns like 'abba' revisit a character whose last index is behind the window.",
          count: 300,
          args: [{ kind: "string", alphabet: "ab", len: { min: 0, max: 8 } }],
        },
        {
          name: "duplicate-heavy",
          rationale: "Many repeats of a small alphabet stress the window update.",
          count: 300,
          args: [{ kind: "string", alphabet: "abc", len: { min: 3, max: 12 } }],
        },
        {
          name: "full-alphabet",
          rationale: "Long strings over the whole alphabet, including windows that run to the end.",
          count: 200,
          args: [{ kind: "string", alphabet: "abcd", len: { min: 0, max: 20 } }],
        },
      ],
    }),
    explain:
      "EXPLANATION: When a character repeats, left is set to last[c] + 1 even if that index is behind the current window start, so the window can move backwards and include a duplicate. In the counterexample the second 'a' pulls left back past the repeated 'b', and the reported length counts a window that contains it twice.\n\n" +
      "```javascript\nfunction solve(s) {\n  const last = new Map();\n  let left = 0;\n  let best = 0;\n  for (let i = 0; i < s.length; i++) {\n    const c = s[i];\n    if (last.has(c)) left = Math.max(left, last.get(c) + 1);\n    last.set(c, i);\n    best = Math.max(best, i - left + 1);\n  }\n  return best;\n}\n```",
  },

  "max-subarray": {
    oracle: "Sum every subarray.\n\n" + py(`
def solve(nums):
    best = None
    for i in range(len(nums)):
        for j in range(i, len(nums)):
            s = sum(nums[i:j + 1])
            if best is None or s > best:
                best = s
    return best`),
    generators: json({
      families: [
        { name: "all-negative", rationale: "The answer is the largest single element, never 0.", count: 200, args: [{ kind: "array", of: { kind: "int", min: -20, max: -1 }, len: { min: 1, max: 6 } }] },
        { name: "short-mixed", rationale: "Short arrays where the best subarray starts at index 0 or ends at the last index.", count: 300, args: [{ kind: "array", of: { kind: "int", min: -6, max: 6, bias: "small" }, len: { min: 1, max: 5 } }] },
        { name: "full-range", rationale: "General coverage at full size.", count: 200, args: [{ kind: "array", of: { kind: "int", min: -20, max: 20 }, len: { min: 1, max: 30 } }] },
      ],
    }),
  },

  "merge-intervals": {
    oracle: "Repeatedly merge any overlapping pair until nothing changes, then sort.\n\n" + py(`
def solve(intervals):
    xs = [list(x) for x in intervals]
    changed = True
    while changed:
        changed = False
        for i in range(len(xs)):
            for j in range(i + 1, len(xs)):
                a, b = xs[i]
                c, d = xs[j]
                if a <= d and c <= b:
                    xs[i] = [min(a, c), max(b, d)]
                    xs.pop(j)
                    changed = True
                    break
            if changed:
                break
    return sorted(xs)`),
    generators: json({
      families: [
        { name: "touching", rationale: "Intervals that share an endpoint must merge.", count: 300, args: [{ kind: "array", of: { kind: "tuple", items: [{ kind: "int", min: 0, max: 6 }, { kind: "int", min: 0, max: 6 }], nondecreasing: true }, len: { min: 2, max: 4 } }] },
        { name: "nested", rationale: "An interval inside another must not shrink the merged end.", count: 300, args: [{ kind: "array", of: { kind: "tuple", items: [{ kind: "int", min: 0, max: 20 }, { kind: "int", min: 0, max: 20 }], nondecreasing: true }, len: { min: 2, max: 5 } }] },
        { name: "two-digit-starts", rationale: "Starts of 10 and above break string-order sorting.", count: 300, args: [{ kind: "array", of: { kind: "tuple", items: [{ kind: "int", min: 2, max: 20 }, { kind: "int", min: 2, max: 20 }], nondecreasing: true }, len: { min: 2, max: 6 } }] },
      ],
    }),
  },

  "two-sum-count": {
    oracle: "Check every pair i < j.\n\n" + py(`
def solve(nums, target):
    count = 0
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            if nums[i] + nums[j] == target:
                count += 1
    return count`),
    generators: json({
      families: [
        { name: "duplicates", rationale: "Repeated values form many equal-sum pairs.", count: 300, args: [{ kind: "array", of: { kind: "int", min: -5, max: 5 }, len: { min: 2, max: 8 }, pool: 2 }, { kind: "int", min: -10, max: 10, bias: "small" }] },
        { name: "self-pairs", rationale: "Targets equal to twice an element must not pair it with itself.", count: 300, args: [{ kind: "array", of: { kind: "int", min: -3, max: 3 }, len: { min: 1, max: 6 } }, { kind: "oneOf", options: [{ kind: "const", value: 0 }, { kind: "const", value: 2 }, { kind: "const", value: -2 }, { kind: "const", value: 4 }] }] },
        { name: "full-range", rationale: "General coverage.", count: 200, args: [{ kind: "array", of: { kind: "int", min: -5, max: 5 }, len: { min: 0, max: 12 } }, { kind: "int", min: -10, max: 10 }] },
      ],
    }),
  },

  "valid-parentheses": {
    oracle: "Repeatedly delete adjacent matching pairs; valid iff nothing remains.\n\n" + py(`
def solve(s):
    prev = None
    while prev != s:
        prev = s
        s = s.replace("()", "").replace("[]", "").replace("{}", "")
    return s == ""`),
    generators: json({
      families: [
        { name: "interleaved", rationale: "Crossed pairs like ([)] balance per type but are invalid.", count: 300, args: [{ kind: "string", alphabet: "()[]", len: { min: 2, max: 6 } }] },
        { name: "unbalanced-ends", rationale: "Leading closers and trailing openers.", count: 300, args: [{ kind: "string", alphabet: "()", len: { min: 1, max: 4 } }] },
        { name: "full-alphabet", rationale: "General coverage.", count: 300, args: [{ kind: "string", alphabet: "()[]{}", len: { min: 0, max: 12 } }] },
      ],
    }),
  },

  "lower-bound": {
    oracle: "Linear scan for the first index with nums[i] >= target.\n\n" + py(`
def solve(nums, target):
    for i, x in enumerate(nums):
        if x >= target:
            return i
    return len(nums)`),
    generators: json({
      families: [
        { name: "many-duplicates", rationale: "Runs of equal values: the answer is the first of the run.", count: 300, args: [{ kind: "array", of: { kind: "int", min: -3, max: 3 }, len: { min: 1, max: 10 }, sorted: "asc", pool: 2 }, { kind: "int", min: -3, max: 3 }] },
        { name: "target-out-of-range", rationale: "Targets above every element must return len(nums).", count: 200, args: [{ kind: "array", of: { kind: "int", min: -10, max: 10 }, len: { min: 0, max: 6 }, sorted: "asc" }, { kind: "int", min: -12, max: 12, bias: "edges" }] },
        { name: "full-range", rationale: "General coverage.", count: 200, args: [{ kind: "array", of: { kind: "int", min: -10, max: 10 }, len: { min: 0, max: 15 }, sorted: "asc" }, { kind: "int", min: -12, max: 12 }] },
      ],
    }),
  },
};
