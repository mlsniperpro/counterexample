/** Line diff (longest common subsequence) between the submitted code and the proposed fix. */
export type DiffLine = { op: "same" | "add" | "del"; text: string };

/** Above this many line pairs the quadratic table is skipped and the caller shows the fix whole. */
export const MAX_DIFF_CELLS = 4_000_000;

/** Lines of `a` removed, lines of `b` added, in order; null when the inputs are too large to diff. */
export function lineDiff(a: string, b: string): DiffLine[] | null {
  // Normalise Windows line endings so pasted CRLF code still lines up with an LF fix.
  const x = a.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const y = b.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const n = x.length;
  const m = y.length;
  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) return null;
  // lcs[i][j] = LCS length of x[i:] and y[j:], in one flat array.
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = x[i] === y[j] ? (lcs[(i + 1) * w + j + 1] as number) + 1 : Math.max(lcs[(i + 1) * w + j] as number, lcs[i * w + j + 1] as number);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ op: "same", text: x[i] as string });
      i++;
      j++;
    } else if ((lcs[(i + 1) * w + j] as number) >= (lcs[i * w + j + 1] as number)) {
      out.push({ op: "del", text: x[i++] as string });
    } else {
      out.push({ op: "add", text: y[j++] as string });
    }
  }
  while (i < n) out.push({ op: "del", text: x[i++] as string });
  while (j < m) out.push({ op: "add", text: y[j++] as string });
  return out;
}
