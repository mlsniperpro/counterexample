import { describe, expect, it } from "vitest";
import { Judge0Executor } from "@/lib/exec/judge0";
import { LocalExecutor } from "@/lib/exec/local";
import { buildProgram, parseLines, runWithRestarts } from "@/lib/exec/program";
import type { RunRequest } from "@/lib/exec/types";

const local = new LocalExecutor();
const base = { entry: "solve", timeLimitMs: 400, memoryLimitMb: 256 } as const;

describe("LocalExecutor (dev only)", () => {
  it("runs Python on many inputs in one process", async () => {
    const r = await local.run({ ...base, language: "python", code: "def solve(a, b):\n    print('noise')\n    return a + b\n", inputs: [[1, 2], [3, 4], [10, -10]] });
    expect(r.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([3, 7, 0]);
    expect(r.processes).toBe(1);
  });

  it("runs JavaScript and keeps console.log out of the results", async () => {
    const r = await local.run({ ...base, language: "javascript", code: "function solve(s) { console.log('x'); return s.split('').reverse().join(''); }", inputs: [["abc"], [""]] });
    expect(r.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual(["cba", ""]);
  });

  it("reports runtime errors per input", async () => {
    const r = await local.run({ ...base, language: "python", code: "def solve(x):\n    return 10 // x\n", inputs: [[2], [0], [5]] });
    expect(r.outcomes[0]).toMatchObject({ ok: true, out: 5 });
    expect(r.outcomes[1]).toMatchObject({ ok: false, error: "runtime" });
    expect(r.outcomes[2]).toMatchObject({ ok: true, out: 2 });
  });

  it("blames a timeout on the right input and restarts after it", async () => {
    const code = "def solve(x):\n    while x == 2:\n        pass\n    return x\n";
    const r = await local.run({ ...base, timeLimitMs: 300, language: "python", code, inputs: [[1], [2], [3]] });
    expect(r.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([1, "timeout", 3]);
    expect(r.processes).toBe(2);
  });

  it("treats syntax errors and a missing entry function as compile errors", async () => {
    const r = await local.run({ ...base, language: "python", code: "def solve(x)\n    return x\n", inputs: [[1], [2]] });
    expect(r.outcomes.every((o) => !o.ok && o.error === "compile")).toBe(true);
    expect(r.processes).toBe(1);
    const r2 = await local.run({ ...base, entry: "nope", language: "javascript", code: "function solve(x) { return x; }", inputs: [[1]] });
    expect(r2.outcomes[0]).toMatchObject({ ok: false, error: "compile" });
  });

  it("enforces the memory limit for Python", async () => {
    const r = await local.run({ ...base, memoryLimitMb: 64, language: "python", code: "def solve(n):\n    return len([0] * n)\n", inputs: [[10], [200_000_000]] });
    expect(r.outcomes[0]).toMatchObject({ ok: true, out: 10 });
    expect(r.outcomes[1].ok).toBe(false);
  });
});

describe("harness program", () => {
  it("rejects entry names that are not identifiers", () => {
    expect(() => buildProgram("python", "", "solve(); import os")).toThrow();
  });

  it("ignores user output that lacks the record marker", () => {
    expect(parseLines('{"ok":true,"out":1}\n\x1eCX{"ok":true,"out":2,"ms":1}\n')).toEqual([{ ok: true, out: 2, ms: 1 }]);
  });

  it("restarts after a crash and marks the crashing input", async () => {
    const calls: number[] = [];
    const r = await runWithRestarts([[1], [2], [3], [4]], async (chunk) => {
      calls.push(chunk.length);
      if (chunk.length === 4) return { lines: [{ ok: true, out: 1, ms: 0 }], end: "crash", message: "segfault" };
      return { lines: chunk.map((c) => ({ ok: true as const, out: c[0], ms: 0 })), end: "ok", message: "" };
    });
    expect(calls).toEqual([4, 2]);
    expect(r.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([1, "runtime", 3, 4]);
  });
});

/** A fake Judge0 that "runs" the program by echoing doubled inputs, with a TLE on input 13. */
function fakeJudge0(requests: Record<string, unknown>[]) {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ ...body, headers: init?.headers });
    const { inputs } = JSON.parse(Buffer.from(body.stdin, "base64").toString());
    let out = "\x1eCR\n";
    let status = { id: 3, description: "Accepted" };
    for (const [x] of inputs as number[][]) {
      if (x === 13) {
        status = { id: 5, description: "Time Limit Exceeded" };
        break;
      }
      out += `\x1eCX${JSON.stringify({ ok: true, out: x * 2, ms: 1 })}\n`;
    }
    return new Response(JSON.stringify({ stdout: Buffer.from(out).toString("base64"), stderr: null, compile_output: null, message: null, status }), { status: 201 });
  }) as typeof fetch;
}

describe("Judge0Executor", () => {
  it("chunks inputs, sends limits and auth, and recovers from a TLE", async () => {
    const requests: Record<string, unknown>[] = [];
    const ex = new Judge0Executor({ baseUrl: "https://judge0.example.com/", token: "t0k", chunkSize: 10, fetchImpl: fakeJudge0(requests) });
    const inputs = Array.from({ length: 25 }, (_, i) => [i]);
    const req: RunRequest = { ...base, language: "python", code: "def solve(x):\n    return 2 * x\n", inputs };
    const r = await ex.run(req);
    expect(r.outcomes[12]).toMatchObject({ ok: true, out: 24 });
    expect(r.outcomes[13]).toMatchObject({ ok: false, error: "timeout" });
    expect(r.outcomes[24]).toMatchObject({ ok: true, out: 48 });
    expect(r.outcomes).toHaveLength(25);
    expect(requests[0]).toMatchObject({ language_id: 71, memory_limit: 256 * 1024 });
    expect((requests[0].headers as Record<string, string>)["X-Auth-Token"]).toBe("t0k");
    expect(ex.label).toBe("Judge0 (judge0.example.com)");
  });

  it("is built from env only when JUDGE0_URL is set", () => {
    expect(Judge0Executor.fromEnv({})).toBeNull();
    expect(Judge0Executor.fromEnv({ JUDGE0_URL: "https://j.example", JUDGE0_LANG_JAVASCRIPT: "93" })).toBeInstanceOf(Judge0Executor);
  });

  it("surfaces HTTP errors", async () => {
    const ex = new Judge0Executor({ baseUrl: "https://j.example", fetchImpl: (async () => new Response("nope", { status: 401 })) as typeof fetch });
    await expect(ex.run({ ...base, language: "python", code: "", inputs: [[1]] })).rejects.toThrow(/HTTP 401/);
  });
});
