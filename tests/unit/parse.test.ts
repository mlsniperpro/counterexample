import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { answerText, extractCode, extractExplanation, extractJson, parseJsonAnswer, stripThinking } from "@/lib/agent/parse";
import { ModelOutputError } from "@/lib/errors";
import { cpuClock } from "../helpers";

describe("model output parsing", () => {
  it("finds a JSON object inside a fence or surrounding prose", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue({ maxDepth: 2 })), fc.constantFrom("", "Sure, here it is:\n", "Answer:"), (obj, prefix) => {
        const json = JSON.stringify(obj);
        expect(extractJson(`${prefix}\`\`\`json\n${json}\n\`\`\``)).toEqual(JSON.parse(json));
        expect(extractJson(`${prefix}${json} thanks`)).toEqual(JSON.parse(json));
      }),
    );
  });

  it("throws ModelOutputError when there is no JSON object", () => {
    for (const t of ["no json", "{ not json }", "[1, 2]", ""]) expect(() => extractJson(t)).toThrow(ModelOutputError);
  });

  it("reads the first balanced object, whatever braces come after it or hide in strings", () => {
    expect(extractJson('{"families":[]} Hope this helps! (a stray } and a {brace)')).toEqual({ families: [] });
    expect(extractJson('{"a":"}{ \\" }","b":{"c":1}} trailing }')).toEqual({ a: '}{ " }', b: { c: 1 } });
    expect(extractJson('Use {x} first, then: {"a":1}')).toEqual({ a: 1 });
    expect(extractJson('a stray { then {"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n``` and then {"a":2}')).toEqual({ a: 1 });
  });

  it("does not make an object out of a truncated one", () => {
    expect(() => extractJson('{"families":[{"name":"a","args":[')).toThrow(ModelOutputError);
    expect(() => extractJson('{"a":"unclosed string}')).toThrow(ModelOutputError);
  });

  it("validates a JSON answer against a schema and names the bad path", () => {
    const schema = z.object({ facts: z.array(z.object({ url: z.string() })) });
    expect(parseJsonAnswer('{"facts":[{"url":"u"}]}', schema, "facts")).toEqual({ facts: [{ url: "u" }] });
    expect(() => parseJsonAnswer('{"facts":[{"url":3}]}', schema, "facts")).toThrow(/facts: facts\.0\.url/);
  });

  it("prefers a code block tagged with the language", () => {
    expect(extractCode("x\n```py\ndef f(): pass\n```", "python")).toBe("def f(): pass\n");
    expect(extractCode("```text\nnope\n```\n```js\nlet a\n```", "javascript")).toBe("let a\n");
    expect(extractCode("```\nuntagged\n```", "python")).toBe("untagged\n");
    expect(() => extractCode("no code", "python")).toThrow(ModelOutputError);
    expect(() => extractCode("```python\n   \n```", "python")).toThrow(ModelOutputError);
  });

  it("stays linear on a text of braces that never close", () => {
    const cpu = cpuClock();
    // 60,000 unclosed braces took 16 s when every one was tried to the end of the text.
    expect(() => extractJson("{".repeat(60_000))).toThrow(ModelOutputError);
    expect(() => extractJson('{"'.repeat(30_000))).toThrow(ModelOutputError);
    expect(cpu()).toBeLessThan(1000);
  });

  it("stays linear on degenerate answers: many blank lines, many unclosed <think> tags", () => {
    const cpu = cpuClock();
    // 32,000 blank lines took 4.7 s when the label pattern's \s* crossed newlines.
    expect(extractExplanation("EXPLANATION: Because x" + "\n".repeat(64_000) + "done")).toBe("Because x" + "\n".repeat(64_000) + "done");
    expect(stripThinking("<think>".repeat(10_000) + "answer")).toBe("<think>".repeat(10_000) + "answer");
    expect(cpu()).toBeLessThan(300);
    // A template that opens the trace in the prompt leaves only its closing tag: the answer is what follows the last one.
    expect(stripThinking("draft ```py\nwrong\n``` </think>FIX:\n```py\nright\n```")).toBe("FIX:\n```py\nright\n```");
    // Think tags inside code are content: a fix that handles the literal tags keeps them, in fences and inline.
    const fix = "EXPLANATION: strip `</think>` first.\n```python\ndef solve(s):\n    return s.replace('<think>', '').replace('</think>', '')\n```";
    expect(stripThinking(fix)).toBe(fix);
    expect(stripThinking("<think>plan</think>" + fix)).toBe(fix);
    expect(answerText("```py\nx = '<think>'\n```\nDone.")).toBe("```py\nx = '<think>'\n```\nDone.");
    // Same results as before on ordinary text.
    expect(stripThinking("a<THINK>x</think>b<think>y</THINK>c<think>open")).toBe("abc<think>open");
    expect(extractExplanation("  Explanation: two.\n\nFIX:\n```py\nx\n```")).toBe("two.");
  });

  it("still finds an object after a few stray braces that never close", () => {
    expect(extractJson('Use {x or {y, then: {"families": []}')).toEqual({ families: [] });
    expect(extractJson("{ ".repeat(30) + '{"a": 1}')).toEqual({ a: 1 });
  });

  it("separates the explanation from code and strips reasoning", () => {
    expect(extractExplanation("EXPLANATION: Two sentences. Really.\n\n```python\nx\n```")).toBe("Two sentences. Really.");
    expect(stripThinking("<think>hmm\nlong</think> answer")).toBe("answer");
    // An answer cut inside its code block: the half block is not part of the explanation.
    expect(extractExplanation("EXPLANATION: Off by one.\n\n```python\ndef solve(a):\n    for i in range(len(a) - 1")).toBe("Off by one.");
    expect(extractExplanation("Fine.\n```py\nx\n```\nMore.\n```")).toBe("Fine.\n\nMore.");
    expect(stripThinking("<THINK>a</THINK>b<think>c</think>")).toBe("b");
  });
});
