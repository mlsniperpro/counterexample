import type { z } from "zod";
import { ModelOutputError } from "../errors";

/** Parsers for model output. Shared by live and replay providers, so replay tests exercise them. */

/** Index just past the object that opens at `start`, reading strings (and their escapes) so braces inside them do not count; -1 when it never closes. */
function objectEnd(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

/** Braces that never close tried per text before giving up on it. */
const MAX_UNCLOSED_STARTS = 32;

/**
 * The first JSON object in the text: inside a ```json fence if there is one,
 * else the first top-level balanced `{...}` that parses (later prose that
 * happens to contain a brace cannot break an earlier object).
 */
export function extractJson(text: string, reviver?: (key: string, value: unknown, ctx?: { source?: string }) => unknown): unknown {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text)?.[1];
  for (const c of [fence, text]) {
    if (!c) continue;
    let unclosed = 0;
    for (let at = c.indexOf("{"); at >= 0; ) {
      const end = objectEnd(c, at);
      if (end < 0) {
        // Never closes (truncated, or a stray brace in prose): look for an object after it. Each such try reads to
        // the end of the text, so only the first few are tried; a text of unclosed braces would otherwise be quadratic.
        if (++unclosed > MAX_UNCLOSED_STARTS) break;
        at = c.indexOf("{", at + 1);
        continue;
      }
      try {
        return JSON.parse(c.slice(at, end), reviver);
      } catch {
        // Balanced but not JSON: try the next object after it.
        at = c.indexOf("{", end);
      }
    }
  }
  throw new ModelOutputError("no JSON object found in model output");
}

/** Extract and validate a JSON answer against a schema. */
export function parseJsonAnswer<T>(text: string, schema: z.ZodType<T>, what: string): T {
  const r = schema.safeParse(extractJson(text));
  if (!r.success) throw new ModelOutputError(`${what}: ${r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  return r.data;
}

/** The first fenced code block, preferring one tagged with the language. */
export function extractCode(text: string, language: "python" | "javascript"): string {
  const tags = language === "python" ? ["python", "py"] : ["javascript", "js"];
  const blocks = [...text.matchAll(/```([\w+-]*)\s*\n([\s\S]*?)```/g)].map((m) => ({ tag: (m[1] ?? "").toLowerCase(), body: m[2] ?? "" }));
  const block = blocks.find((b) => tags.includes(b.tag)) ?? blocks[0];
  if (!block || !block.body.trim()) throw new ModelOutputError("no code block found in model output");
  return block.body.trimEnd() + "\n";
}

/**
 * Spans of code in a model answer, in order: fenced blocks (to the end of the text when a fence never closes) and
 * inline code on one line. Think tags inside them are content (a fix that handles the literal "</think>"), not markup.
 */
function codeSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (let i = 0; i < text.length; ) {
    if (text.startsWith("```", i)) {
      const close = text.indexOf("```", i + 3);
      const end = close < 0 ? text.length : close + 3;
      spans.push([i, end]);
      i = end;
    } else if (text[i] === "`") {
      const close = text.indexOf("`", i + 1);
      const nl = text.indexOf("\n", i + 1);
      if (close >= 0 && (nl < 0 || close < nl)) {
        spans.push([i, close + 1]);
        i = close + 1;
      } else i++;
    } else i++;
  }
  return spans;
}

/** The span containing `at`, found by binary search (the spans are sorted and disjoint). */
function spanAt(spans: [number, number][], at: number): [number, number] | undefined {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const span = spans[mid] as [number, number];
    if (at < span[0]) hi = mid - 1;
    else if (at >= span[1]) lo = mid + 1;
    else return span;
  }
  return undefined;
}

/** The first match of `tag` at or after `from` that is not inside a code span, or undefined. */
function tagOutsideCode(text: string, tag: RegExp, from: number, spans: [number, number][]): RegExpExecArray | undefined {
  tag.lastIndex = from;
  for (let m = tag.exec(text); m; m = tag.exec(text)) {
    const span = spanAt(spans, m.index);
    if (!span) return m;
    tag.lastIndex = span[1];
  }
  return undefined;
}

/**
 * Strip reasoning traces some models emit before the answer. One forward scan: a regex retried from every unclosed
 * `<think>` rereads the rest of the text each time (quadratic on a degenerate answer). A `<think>` that never closes
 * is left in place, for answerText to cut. Tags inside code are left alone.
 */
export function stripThinking(text: string): string {
  const spans = codeSpans(text);
  const open = /<think>/gi;
  const close = /<\/think>/gi;
  let at = 0;
  let out = "";
  for (;;) {
    const o = tagOutsideCode(text, open, at, spans);
    if (!o) break;
    const c = tagOutsideCode(text, close, o.index + o[0].length, spans);
    if (!c) break;
    out += text.slice(at, o.index);
    at = c.index + c[0].length;
  }
  // Some reasoning templates open the trace in the prompt, so the answer holds only its closing tag: drop everything
  // up to the last one outside code.
  let after = at;
  for (let c = tagOutsideCode(text, close, at, spans); c; c = tagOutsideCode(text, close, c.index + c[0].length, spans)) after = c.index + c[0].length;
  return (after > at ? text.slice(after) : out + text.slice(at)).trim();
}

/** The answer a reader would see: no reasoning trace, and nothing after a `<think>` (outside code) that never closes (an answer cut inside its thinking has no answer in it). */
export function answerText(text: string): string {
  const stripped = stripThinking(text);
  const open = tagOutsideCode(stripped, /<think>/gi, 0, codeSpans(stripped));
  return (open ? stripped.slice(0, open.index) : stripped).trim();
}

/** Explanation text = everything outside code fences (a fence never closed, as in a cut answer, runs to the end), minus a leading label. */
export function extractExplanation(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/```[\s\S]*$/, "")
    // Within a line only: a \s* before the label crossed newlines, so each blank line rescanned the rest of the text.
    .replace(/^[ \t]*(EXPLANATION|Explanation)[ \t]*:\s*/m, "")
    .replace(/^[ \t]*(FIX|Fix)[ \t]*:[ \t]*$/m, "")
    .trim();
}
