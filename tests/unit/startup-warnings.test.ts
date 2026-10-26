import { describe, expect, it } from "vitest";
import { attack } from "@/lib/agent/run";
import { makeDeps, startupWarnings } from "@/lib/agent/setup";
import { BUILT_INS } from "@/lib/problems/catalog";

const bs = BUILT_INS.find((b) => b.problem.id === "binary-search")!;
const env = { NODE_ENV: "test" };

describe("startup warnings", () => {
  it("are empty when the runtime reads exact big integers, and name the Node requirement when it cannot", () => {
    expect(startupWarnings(true)).toEqual([]);
    const [w] = startupWarnings(false);
    expect(w).toMatch(/exact big integers/);
    expect(w).toMatch(/Node 21\+/);
    expect(makeDeps({ mode: "replay", env }).warnings).toEqual(startupWarnings());
  });

  it("show up as one warn event per attack in the trace", async () => {
    const deps = { ...makeDeps({ mode: "replay", env }), warnings: startupWarnings(false) };
    const r = await attack({ problem: bs.problem, solution: bs.demo, research: "off" }, deps);
    expect(r.trace.filter((e) => e.kind === "warn" && /exact big integers/.test(e.msg))).toHaveLength(1);
    const clean = await attack({ problem: bs.problem, solution: bs.demo, research: "off" }, makeDeps({ mode: "replay", env }));
    expect(clean.trace.some((e) => /exact big integers/.test(e.msg))).toBe(false);
  });
});
