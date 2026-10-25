export type Span = { code: boolean; text: string };

/**
 * Split text on Markdown backticks into plain and `code` spans. Only single
 * backticks are recognised; an unmatched trailing backtick and an empty pair
 * stay as literal text. The result is rendered as React text nodes, never as HTML.
 */
export function splitCode(s: string): Span[] {
  const parts = s.split("`");
  // An even number of parts means an odd number of backticks: the last one has no partner.
  if (parts.length % 2 === 0) parts.splice(-2, 2, `${parts[parts.length - 2]}\`${parts[parts.length - 1]}`);
  const out: Span[] = [];
  parts.forEach((text, i) => {
    const code = i % 2 === 1 && text !== "";
    const t = i % 2 === 1 && !code ? "``" : text;
    if (!t) return;
    const last = out[out.length - 1];
    if (!code && last && !last.code) last.text += t;
    else out.push({ code, text: t });
  });
  return out;
}
