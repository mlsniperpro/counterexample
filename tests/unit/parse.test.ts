import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractCode, extractExplanation, extractJson, parseJsonAnswer, stripThinking } from "@/lib/agent/parse";
import { ModelOutputError } from "@/lib/errors";

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

  it("separates the explanation from code and strips reasoning", () => {
    expect(extractExplanation("EXPLANATION: Two sentences. Really.\n\n```python\nx\n```")).toBe("Two sentences. Really.");
    expect(stripThinking("<think>hmm\nlong</think> answer")).toBe("answer");
    expect(stripThinking("<THINK>a</THINK>b<think>c</think>")).toBe("b");
  });
});
