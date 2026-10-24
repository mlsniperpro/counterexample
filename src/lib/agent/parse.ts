import type { z } from "zod";
import { ModelOutputError } from "../errors";

/** Parsers for model output. Shared by live and replay providers, so replay tests exercise them. */

/** The first JSON object in the text: inside a ```json fence if there is one, else the outermost braces. */
export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text)?.[1];
  for (const c of [fence, text]) {
    if (!c) continue;
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch {
      // try the next candidate
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
