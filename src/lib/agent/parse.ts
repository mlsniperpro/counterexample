/** Parsers for model output. Shared by live and replay providers, so replay tests exercise them. */

export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text);
  const candidates = [fence?.[1], text];
  for (const c of candidates) {
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
  throw new Error("no JSON object found in model output");
}

/** The first fenced code block, preferring one tagged with the language. */
export function extractCode(text: string, language: "python" | "javascript"): string {
  const tags = language === "python" ? ["python", "py"] : ["javascript", "js"];
  const blocks = [...text.matchAll(/```([\w+-]*)\s*\n([\s\S]*?)```/g)];
  const tagged = blocks.find((b) => tags.includes(b[1].toLowerCase()));
  const block = tagged ?? blocks[0];
  if (!block) throw new Error("no code block found in model output");
  return block[2].trimEnd() + "\n";
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
