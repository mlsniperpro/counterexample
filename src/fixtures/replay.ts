/**
 * Deterministic replay fixtures: hand-written responses in the shape the
 * models are prompted to produce (fenced code, JSON), so the real parsers run.
 * Replace or extend them with real recordings from `pnpm bench --live --record`.
 * Recorded search results quote or closely paraphrase the cited pages (checked
 * on 2026-10-24); they stand in for Tavily output in replay mode.
 */
import type { ReplayFixtures } from "../lib/models/replay";
import type { SearchResult } from "../lib/research/tavily";
import { REFERENCES } from "../lib/problems/demos.generated";

const py = (s: string) => "```python\n" + s.trim() + "\n```";
const json = (o: unknown) => "```json\n" + JSON.stringify(o, null, 2) + "\n```";

export const LEETCODE_704 = "https://leetcode.com/problems/binary-search/description/";
export const BS_EDGE_DISCUSS = "https://en.wikipedia.org/wiki/Binary_search_algorithm#Implementation_issues";
export const ISQRT_WIKI = "https://en.wikipedia.org/wiki/Integer_square_root";
export const CHANGE_MAKING_WIKI = "https://en.wikipedia.org/wiki/Change-making_problem";
export const DIJKSTRA_WIKI = "https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm";
export const MDN_SORT = "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort";
export const MDN_RIGHT_SHIFT = "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Right_shift";
export const MDN_MATH_ROUND = "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/round";
export const PY_ROUND = "https://docs.python.org/3/library/functions.html#round";
export const LEETCODE_3 = "https://leetcode.com/problems/longest-substring-without-repeating-characters/description/";

export const RESEARCH_RESULTS: Record<string, SearchResult[]> = {
  // API documentation (questions asked because of what the code calls; see src/lib/research/plan.ts).
  "JavaScript Array.prototype.sort default sort order without compareFn": [
    {
      title: "Array.prototype.sort() - JavaScript | MDN",
      url: MDN_SORT,
      content:
        "If compareFn is not supplied, all non-undefined array elements are sorted by converting them to strings and comparing strings in UTF-16 code units order. In a numeric sort, 9 comes before 80, but because numbers are converted to strings, \"80\" comes before \"9\" in the Unicode order.",
    },
  ],
  "JavaScript right shift operator converts operands to 32-bit integers": [
    {
      title: "Right shift (>>) - JavaScript | MDN",
      url: MDN_RIGHT_SHIFT,
      content:
        "It performs BigInt right shift if both operands become BigInts; otherwise, it converts both operands to 32-bit integers and performs number right shift. If the left operand is a number with more than 32 bits, it will get the most significant bits discarded.",
    },
  ],
  "JavaScript Math.round fractional part exactly 0.5": [
    {
      title: "Math.round() - JavaScript | MDN",
      url: MDN_MATH_ROUND,
      content:
        "If the fractional portion is exactly 0.5, the argument is rounded to the next integer in the direction of +Infinity. This differs from many languages' round() functions, which often round half-increments away from zero.",
    },
  ],
  "Python built-in round ties to even": [
    {
      title: "Built-in Functions - Python documentation",
      url: PY_ROUND,
      content:
        "Values are rounded to the closest multiple of 10 to the power minus ndigits; if two multiples are equally close, rounding is done toward the even choice (so, for example, both round(0.5) and round(-0.5) are 0, and round(1.5) is 2).",
    },
  ],
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
        "An infinite loop may occur if the exit conditions for the loop are not defined correctly. Once L exceeds R, the search has failed and must convey the failure of the search. Bentley found that most of the programmers who incorrectly implemented binary search made an error in defining the exit conditions.",
    },
  ],
  "Integer square root constraints edge cases": [
    {
      title: "Integer square root - Wikipedia",
      url: ISQRT_WIKI,
      content:
        "The integer square root of a non-negative integer n is the non-negative integer m which is the greatest integer less than or equal to the square root of n. A speed-up is achieved by using binary search instead.",
    },
    {
      title: "Binary search - Implementation issues",
      url: BS_EDGE_DISCUSS,
      content:
        "This can result in an arithmetic overflow for very large arrays: the value of L + R may exceed the range of integers of the data type used to store the midpoint, even if L and R are within the range. If L and R are nonnegative, this can be avoided by calculating the midpoint as L + (R - L) / 2.",
    },
  ],
  "Coin change (fewest coins) constraints edge cases": [
    {
      title: "Change-making problem - Wikipedia",
      url: CHANGE_MAKING_WIKI,
      content:
        "A coin system is called canonical if the greedy algorithm always solves its change-making problem optimally. For many real-world coin systems, such as those used in the US, the greedy approach will produce the optimal result. With coins of 25, 10 and 1 (no 5), making 40 greedily uses seven coins, while four 10-cent coins is optimal.",
    },
  ],
  "Shortest paths with negative edges constraints edge cases": [
    {
      title: "Dijkstra's algorithm - Wikipedia",
      url: DIJKSTRA_WIKI,
      content:
        "Negative weights are not allowed. Unlike Dijkstra's algorithm, the Bellman-Ford algorithm can be used on graphs with negative edge weights, as long as the graph contains no negative cycle reachable from the source vertex.",
    },
  ],
  "Longest substring without repeats constraints edge cases": [
    {
      title: "Longest Substring Without Repeating Characters - LeetCode",
      url: LEETCODE_3,
      content:
        "Given a string s, find the length of the longest substring without duplicate characters. Example: s = \"pwwkew\" gives 3; the answer must be a substring, \"pwke\" is a subsequence and not a substring. Constraints: 0 <= s.length <= 5 * 10^4.",
    },
  ],
};

export const FIXTURES: ReplayFixtures = {
  // Research summaries for API-documentation questions, shared by every problem ("api?q=<query>").
  "api?q=JavaScript Array.prototype.sort default sort order without compareFn": {
    research: json({ facts: [{ fact: "Without a comparator, sort() compares elements as strings, so 10 sorts before 9; numeric data with mixed digit counts is mis-ordered.", url: MDN_SORT }] }),
  },
  "api?q=JavaScript right shift operator converts operands to 32-bit integers": {
    research: json({ facts: [{ fact: ">> converts its operands to 32-bit integers, so a sum at or above 2^31 wraps to a negative number before the shift.", url: MDN_RIGHT_SHIFT }] }),
  },
  "api?q=JavaScript Math.round fractional part exactly 0.5": {
    research: json({ facts: [{ fact: "Math.round rounds to the nearest integer (halves toward +Infinity); it is not floor, so rounding a square root overshoots whenever its fraction is at least 0.5.", url: MDN_MATH_ROUND }] }),
  },
  "api?q=Python built-in round ties to even": {
    research: json({ facts: [{ fact: "round() sends exact halves to the even neighbour: round(0.5) and round(-0.5) are 0, round(1.5) is 2.", url: PY_ROUND }] }),
  },
  "binary-search": {
    research: json({
      facts: [
        { fact: "nums has at least 1 element (1 <= nums.length <= 10^4), so one-element arrays are legal and important.", url: LEETCODE_704 },
        { fact: "All integers in nums are unique and sorted ascending; values and target lie strictly inside (-10^4, 10^4).", url: LEETCODE_704 },
        { fact: "Most incorrect binary searches get the loop's exit condition wrong; test targets at both ends and in one-element ranges.", url: BS_EDGE_DISCUSS },
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
    research: json({
      facts: [
        { fact: "isqrt(n) is the greatest integer m with m * m <= n; check perfect squares and their neighbours.", url: ISQRT_WIKI },
        { fact: "Computing the midpoint as L + R can overflow the integer type even when L and R are in range; test the largest allowed n.", url: BS_EDGE_DISCUSS },
      ],
    }),
    oracle: "math.isqrt is exact for arbitrary-precision integers.\n\n" + py(`
import math

def solve(x):
    return math.isqrt(x)`),
    generators: json({
      families: [
        {
          name: "int32-bounds",
          citations: [ISQRT_WIKI, BS_EDGE_DISCUSS, MDN_RIGHT_SHIFT],
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
          citations: [MDN_MATH_ROUND],
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
    research: json({
      facts: [
        { fact: "Greedy is optimal only for canonical coin systems; with coins 25, 10, 1, greedy uses 7 coins for 40 where 4 suffice.", url: CHANGE_MAKING_WIKI },
      ],
    }),
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
          citations: [CHANGE_MAKING_WIKI],
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
    research: json({
      facts: [
        { fact: "Dijkstra's algorithm does not allow negative weights; Bellman-Ford handles them when no negative cycle is reachable.", url: DIJKSTRA_WIKI },
      ],
    }),
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
          citations: [DIJKSTRA_WIKI],
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
    research: json({
      facts: [
        { fact: "The empty string is allowed (0 <= s.length), and the answer must be a contiguous substring, not a subsequence.", url: LEETCODE_3 },
      ],
    }),
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
          citations: [LEETCODE_3],
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
        { name: "two-digit-starts", rationale: "Starts of 10 and above break string-order sorting.", citations: [MDN_SORT], count: 300, args: [{ kind: "array", of: { kind: "tuple", items: [{ kind: "int", min: 2, max: 20 }, { kind: "int", min: 2, max: 20 }], nondecreasing: true }, len: { min: 2, max: 6 } }] },
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

/** Replay key for a built-in problem whose demo code the user edited (same language as the demo, or another one). */
export const editedKey = (problemId: string, sameLanguage = true) => `${problemId}/${sameLanguage ? "edited" : "edited-other-language"}`;

/**
 * Edited code has no recorded explanation. Rather than replaying the demo's
 * (now wrong) explanation, say so and offer the reference solution, which is
 * still re-attacked like any proposed fix.
 */
for (const [id, code] of Object.entries(REFERENCES)) {
  FIXTURES[editedKey(id)] = {
    explain:
      "EXPLANATION: Replay mode has no recorded explanation for edited code, so this is the problem's reference solution rather than a targeted fix of your code. The counterexample above is real: it was found and shrunk by running your code against the oracle.\n\n```\n" +
      code +
      "```",
  };
  // No reference exists in the other language: explain without a fix (nothing to re-attack).
  FIXTURES[editedKey(id, false)] = {
    explain:
      "EXPLANATION: Replay mode has no recorded explanation or reference fix in this language for edited code. The counterexample above is real: it was found and shrunk by running your code against the oracle.",
  };
}
