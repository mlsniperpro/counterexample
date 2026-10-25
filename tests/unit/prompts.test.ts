import { describe, expect, it } from "vitest";
import { explainPrompt, oraclePrompt } from "@/lib/agent/prompts";
import type { Problem } from "@/lib/problems/types";

const BIG = "\u0000int:15999999992000000001";
const problem: Problem = {
  id: "p",
  title: "T",
  statement: "S",
  params: [{ name: "x", type: { kind: "int", min: 0, max: 10 } }],
  returns: "r",
  examples: [{ args: [1, 2 ** 60], output: BIG }],
  compare: "exact",
  timeLimitMs: 1000,
  memoryLimitMb: 256,
};
const text = (m: { content: string }[]) => m.map((x) => x.content).join("\n");

describe("prompts show big integers as digits, never as the internal marker string", () => {
  it("lists example arguments and outputs as plain digits", () => {
    const t = text(oraclePrompt(problem));
    expect(t).toContain("- solve(1, 1152921504606846976) == 15999999992000000001");
    expect(t).not.toContain("int:");
  });

  it("writes the counterexample's arguments and expected output the same way", () => {
    const t = text(explainPrompt(problem, { language: "python", code: "x", entry: "solve" }, [2 ** 60], BIG, "0"));
    expect(t).toContain("solve(1152921504606846976) should return 15999999992000000001 but returned 0");
    expect(t).not.toContain("int:");
  });
});
