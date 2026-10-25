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

/**
 * The first JSON object in the text: inside a ```json fence if there is one,
 * else the first top-level balanced `{...}` that parses (later prose that
 * happens to contain a brace cannot break an earlier object).
 */
export function extractJson(text: string, reviver?: (key: string, value: unknown, ctx?: { source?: string }) => unknown): unknown {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text)?.[1];
  for (const c of [fence, text]) {
    if (!c) continue;
    for (let at = c.indexOf("{"); at >= 0; ) {
      const end = objectEnd(c, at);
      if (end < 0) {
        // Never closes (truncated, or a stray brace in prose): look for an object after it.
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

/** Strip reasoning traces some models emit before the answer. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/** Explanation text = everything outside code fences, minus a leading label. */
export function extractExplanation(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*(EXPLANATION|Explanation)\s*:\s*/m, "")
    .replace(/^\s*(FIX|Fix)\s*:\s*$/m, "")
    .trim();
}
