/**
 * The longest-path figures the README quotes for random graphs, from the DSL's own generator: on 1,000 nodes, the
 * longest path (in edges) of a random DAG with 10,000 edges over seeds 1 to 20, and with 2,000 edges over seeds 1 to
 * 200. They show why a graph family needs `shape: "path"` to reach a deep graph.
 *
 *   pnpm exec tsx bench/longest-path.ts
 */
import { mulberry32 } from "../src/lib/core/rng";
import { genArgs, type GraphSpec } from "../src/lib/core/spec";

/** Edges on the longest path of a DAG whose edges all go from a lower to a higher node. */
export function longestPath(n: number, edges: number[][]): number {
  const depth = new Array<number>(n).fill(0);
  const out: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) out[u as number]?.push(v as number);
  let best = 0;
  for (let u = 0; u < n; u++) {
    for (const v of out[u] ?? []) depth[v] = Math.max(depth[v] as number, (depth[u] as number) + 1);
    best = Math.max(best, depth[u] as number);
  }
  return best;
}

function stats(edges: number, seeds: number): string {
  const spec: GraphSpec = { kind: "graph", n: { min: 1000, max: 1000 }, m: { min: edges, max: edges }, weight: { min: 0, max: 10 }, dag: true };
  const lengths = Array.from({ length: seeds }, (_, i) => {
    const [n, es] = genArgs([spec], mulberry32(i + 1)) as [number, number[][]];
    return longestPath(n, es);
  }).sort((a, b) => a - b);
  return `1,000 nodes, ${edges.toLocaleString("en-US")} edges, seeds 1 to ${seeds}: longest path ${lengths[0]} to ${lengths.at(-1)} edges, median ${lengths[Math.floor(seeds / 2)]}`;
}

console.log(stats(10_000, 20));
console.log(stats(2_000, 200));
