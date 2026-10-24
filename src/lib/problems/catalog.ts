import { DEMOS } from "./demos.generated";
import type { BuiltIn, Problem } from "./types";

const INT32_MAX = 2147483647;

export const PROBLEMS: Problem[] = [
  {
    id: "binary-search",
    title: "Binary search",
    statement:
      "Given a sorted array of distinct integers `nums` and an integer `target`, return the index of `target` in `nums`, or -1 if it is absent. Constraints follow LeetCode 704 (Binary Search).",
    params: [
      { name: "nums", type: { kind: "array", of: { kind: "int", min: -10000, max: 10000 }, len: { min: 1, max: 40 }, sorted: "asc", distinct: true } },
      { name: "target", type: { kind: "int", min: -10000, max: 10000 } },
    ],
    returns: "index of target, or -1",
    examples: [
      { args: [[-1, 0, 3, 5, 9, 12], 9], output: 4 },
      { args: [[-1, 0, 3, 5, 9, 12], 2], output: -1 },
    ],
    compare: "exact",
    timeLimitMs: 300,
    memoryLimitMb: 256,
    references: ["LeetCode 704 Binary Search official constraints"],
  },
  {
    id: "isqrt",
    title: "Integer square root",
    statement:
      "Given a non-negative 32-bit signed integer `x`, return floor(sqrt(x)) without using a built-in exponent function. 0 <= x <= 2^31 - 1.",
    params: [{ name: "x", type: { kind: "int", min: 0, max: INT32_MAX } }],
    returns: "floor(sqrt(x))",
    examples: [
      { args: [4], output: 2 },
      { args: [8], output: 2 },
    ],
    compare: "exact",
    timeLimitMs: 300,
    memoryLimitMb: 256,
  },
  {
    id: "coin-change",
    title: "Coin change (fewest coins)",
    statement:
      "Given distinct coin denominations `coins` (each 1..20, at most 5 of them) and an `amount` (0..60), return the fewest coins that sum to `amount`, using each denomination any number of times, or -1 if impossible.",
    params: [
      { name: "coins", type: { kind: "array", of: { kind: "int", min: 1, max: 20 }, len: { min: 1, max: 5 }, distinct: true } },
      { name: "amount", type: { kind: "int", min: 0, max: 60 } },
    ],
    returns: "fewest coins, or -1",
    examples: [
      { args: [[1, 2, 5], 11], output: 3 },
      { args: [[2], 3], output: -1 },
      { args: [[1], 0], output: 0 },
    ],
    compare: "exact",
    timeLimitMs: 300,
    memoryLimitMb: 256,
  },
  {
    id: "shortest-paths",
    title: "Shortest paths with negative edges",
    statement:
      "A directed graph has `n` nodes (0..n-1, 1 <= n <= 7) and `edges` given as [u, v, w] with u < v (so there are no cycles) and weights -5..10, which may be negative. Return the list of shortest distances from node 0, with null for unreachable nodes.",
    params: [{ name: "n, edges", type: { kind: "graph", n: { min: 1, max: 7 }, m: { min: 0, max: 14 }, weight: { min: -5, max: 10 }, dag: true } }],
    returns: "distances from node 0 (null if unreachable)",
    examples: [
      { args: [3, [[0, 1, 1], [0, 2, 4], [1, 2, 2]]], output: [0, 1, 3] },
      { args: [2, []], output: [0, null] },
    ],
    compare: "exact",
    timeLimitMs: 300,
    memoryLimitMb: 256,
  },
  {
    id: "longest-unique-substring",
    title: "Longest substring without repeats",
    statement:
      "Given a string `s` over the letters a-d (length 0..20), return the length of the longest substring without repeating characters.",
    params: [{ name: "s", type: { kind: "string", alphabet: "abcd", len: { min: 0, max: 20 } } }],
    returns: "length of the longest substring with all-distinct characters",
    examples: [
      { args: ["abcabcbb"], output: 3 },
      { args: ["bbbbb"], output: 1 },
      { args: [""], output: 0 },
    ],
    compare: "exact",
    timeLimitMs: 300,
    memoryLimitMb: 256,
  },
  {
    id: "max-subarray",
    title: "Maximum subarray sum",
    statement: "Given a non-empty integer array `nums` (values -20..20, length 1..30), return the largest sum of a non-empty contiguous subarray.",
    params: [{ name: "nums", type: { kind: "array", of: { kind: "int", min: -20, max: 20 }, len: { min: 1, max: 30 } } }],
    returns: "maximum subarray sum",
    examples: [
      { args: [[-2, 1, -3, 4, -1, 2, 1, -5, 4]], output: 6 },
      { args: [[1]], output: 1 },
      { args: [[5, 4, -1, 7, 8]], output: 23 },
    ],
    compare: "exact",
    timeLimitMs: 300,
    memoryLimitMb: 256,
  },
  {
    id: "merge-intervals",
    title: "Merge intervals",
    statement:
      "Given up to 8 closed integer intervals [start, end] with 0 <= start <= end <= 20, merge every pair that overlaps or touches and return the merged intervals sorted by start.",
    params: [
      {
        name: "intervals",
        type: { kind: "array", of: { kind: "tuple", items: [{ kind: "int", min: 0, max: 20 }, { kind: "int", min: 0, max: 20 }], nondecreasing: true }, len: { min: 0, max: 8 } },
      },
    ],
    returns: "merged intervals sorted by start",
    examples: [
      { args: [[[1, 3], [2, 6], [8, 10], [15, 18]]], output: [[1, 6], [8, 10], [15, 18]] },
      { args: [[[1, 4], [4, 5]]], output: [[1, 5]] },
    ],
    compare: "exact",
    timeLimitMs: 300,
    memoryLimitMb: 256,
  },
  {
    id: "two-sum-count",
    title: "Count pairs with a given sum",
    statement: "Given `nums` (values -5..5, length 0..12) and `target` (-10..10), return the number of index pairs i < j with nums[i] + nums[j] == target.",
    params: [
      { name: "nums", type: { kind: "array", of: { kind: "int", min: -5, max: 5 }, len: { min: 0, max: 12 } } },
      { name: "target", type: { kind: "int", min: -10, max: 10 } },
    ],
    returns: "number of pairs",
    examples: [
      { args: [[1, 2, 3, 4], 5], output: 2 },
      { args: [[], 0], output: 0 },
    ],
    compare: "exact",
    timeLimitMs: 300,
    memoryLimitMb: 256,
  },
  {
    id: "valid-parentheses",
    title: "Valid brackets",
    statement: "Given a string `s` of the characters ()[]{} (length 0..12), return true if every bracket is closed by the same type in the correct order.",
    params: [{ name: "s", type: { kind: "string", alphabet: "()[]{}", len: { min: 0, max: 12 } } }],
    returns: "true if valid",
    examples: [
      { args: ["()[]{}"], output: true },
      { args: ["(]"], output: false },
      { args: [""], output: true },
    ],
    compare: "exact",
    timeLimitMs: 300,
    memoryLimitMb: 256,
  },
  {
    id: "lower-bound",
    title: "Lower bound (first index >= target)",
    statement:
      "Given a sorted array `nums` (values -10..10, length 0..15, duplicates allowed) and `target` (-12..12), return the first index i with nums[i] >= target, or len(nums) if there is none.",
    params: [
      { name: "nums", type: { kind: "array", of: { kind: "int", min: -10, max: 10 }, len: { min: 0, max: 15 }, sorted: "asc" } },
      { name: "target", type: { kind: "int", min: -12, max: 12 } },
    ],
    returns: "first index with nums[i] >= target",
    examples: [
      { args: [[1, 3, 5, 6], 2], output: 1 },
      { args: [[], 3], output: 0 },
    ],
    compare: "exact",
    timeLimitMs: 300,
    memoryLimitMb: 256,
  },
];

const DEMO_LANG: Record<string, "python" | "javascript"> = {
  "binary-search": "python",
  isqrt: "javascript",
  "coin-change": "python",
  "shortest-paths": "python",
  "longest-unique-substring": "javascript",
};

/** The 5 built-in demo problems, each with a subtly buggy solution. */
export const BUILT_INS: BuiltIn[] = Object.entries(DEMO_LANG).map(([id, language]) => {
  const problem = getProblem(id);
  const demo = DEMOS[id];
  if (!problem || !demo) throw new Error(`built-in ${id} is missing its problem or demo solution`);
  return { problem, demo: { language, code: demo.code, entry: "solve", bug: demo.bug } };
});

export function getProblem(id: string): Problem | undefined {
  return PROBLEMS.find((p) => p.id === id);
}
