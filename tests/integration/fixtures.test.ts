import { describe, expect, it } from "vitest";
import { extractCode } from "@/lib/agent/parse";
import { outputsEqual } from "@/lib/core/compare";
import { LocalExecutor } from "@/lib/exec/local";
import { FIXTURES } from "@/fixtures/replay";
import { PROBLEMS } from "@/lib/problems/catalog";
import { loadSubjects } from "../../bench/lib";

const local = new LocalExecutor();
const subjects = loadSubjects(process.cwd());

describe("replay fixtures and benchmark subjects against the real sandbox", () => {
  for (const p of PROBLEMS) {
    it(`${p.id}: the recorded oracle and the correct solution pass every example; every buggy solution still loads`, async () => {
      const examples = p.examples.map((e) => e.args);
      const oracle = await local.run({ language: "python", code: extractCode(FIXTURES[p.id]?.oracle as string, "python"), entry: "solve", inputs: examples, timeLimitMs: 2000, memoryLimitMb: 256 });
      oracle.outcomes.forEach((o, i) => expect(o.ok && outputsEqual(o.out, p.examples[i]!.output, p.compare), `oracle example ${i}`).toBe(true));
      for (const s of subjects.filter((x) => x.problem === p.id)) {
        const r = await local.run({ language: s.language, code: s.code, entry: "solve", inputs: examples, timeLimitMs: 2000, memoryLimitMb: 256 });
        expect(r.outcomes.every((o) => o.ok || o.error !== "compile"), `${s.key} loads`).toBe(true);
        if (!s.buggy) r.outcomes.forEach((o, i) => expect(o.ok && outputsEqual(o.out, p.examples[i]!.output, p.compare), `${s.key} example ${i}`).toBe(true));
      }
    });
  }
});
