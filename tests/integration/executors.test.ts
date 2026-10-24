import { describe, expect, it } from "vitest";
import { ConfigError, ExecutorError, UpstreamError } from "@/lib/errors";
import { Judge0Executor } from "@/lib/exec/judge0";
import { errorSummary, LocalExecutor } from "@/lib/exec/local";
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

  it("does not wait on a forked child that holds the output pipe, whether the program hangs or exits", async () => {
    const fork = "import os, time\ndef solve(x):\n    if os.fork() == 0:\n        time.sleep(30)\n        os._exit(0)\n    while x == 2:\n        pass\n    return x\n";
    const t0 = Date.now();
    const r = await local.run({ ...base, timeLimitMs: 300, language: "python", code: fork, inputs: [[1], [2], [3]] });
    expect(r.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([1, "timeout", 3]);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it("runs a Python solution that has a __main__ block and a JavaScript one written as an ES module", async () => {
    const py = "import sys\ndef solve(x):\n    return x + 1\nif __name__ == '__main__':\n    print(solve(int(sys.stdin.read())))\n";
    const r = await local.run({ ...base, language: "python", code: py, inputs: [[1], [2]] });
    expect(r.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([2, 3]);
    const js = "export function solve(x) { return x + 1; }";
    const j = await local.run({ ...base, language: "javascript", code: js, inputs: [[1]] });
    expect(j.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([2]);
  });

  it("treats syntax errors and a missing entry function as compile errors", async () => {
    const r = await local.run({ ...base, language: "python", code: "def solve(x)\n    return x\n", inputs: [[1], [2]] });
    expect(r.outcomes.every((o) => !o.ok && o.error === "compile")).toBe(true);
    expect(r.processes).toBe(1);
    const r2 = await local.run({ ...base, entry: "nope", language: "javascript", code: "function solve(x) { return x; }", inputs: [[1]] });
    expect(r2.outcomes[0]).toMatchObject({ ok: false, error: "compile" });
  });

  it("caps runaway output", async () => {
    const code = "def solve(n):\n    return 'x' * n\n";
    const r = await local.run({ ...base, timeLimitMs: 5000, language: "python", code, inputs: [[3], [40 * 1024 * 1024], [2]] });
    expect(r.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual(["xxx", "runtime", "xx"]);
    expect(r.outcomes[1]).toMatchObject({ message: expect.stringMatching(/output limit/) });
  });

  it("does not let user code read the server's secrets from the environment", async () => {
    process.env.CX_TEST_SECRET = "s3cret";
    try {
      const r = await local.run({ ...base, language: "javascript", code: "function solve() { return process.env.CX_TEST_SECRET ?? null; }", inputs: [[]] });
      expect(r.outcomes[0]).toEqual({ ok: true, out: null, ms: expect.any(Number) });
    } finally {
      delete process.env.CX_TEST_SECRET;
    }
  });

  it("kills the process and rejects when the caller aborts", async () => {
    const ac = new AbortController();
    const t0 = Date.now();
    setTimeout(() => ac.abort(new Error("cancelled")), 100);
    const p = local.run({ ...base, timeLimitMs: 10_000, language: "python", code: "def solve(x):\n    while True:\n        pass\n", inputs: [[1]], signal: ac.signal });
    await expect(p).rejects.toThrow("cancelled");
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("reports a missing runtime as an ExecutorError, not a user-code error", async () => {
    const path = process.env.PATH;
    process.env.PATH = "/nonexistent";
    try {
      await expect(local.run({ ...base, language: "javascript", code: "function solve() {}", inputs: [[]] })).rejects.toThrow(ExecutorError);
    } finally {
      process.env.PATH = path;
    }
  });

  it("enforces the memory limit for Python", async () => {
    const r = await local.run({ ...base, memoryLimitMb: 64, language: "python", code: "def solve(n):\n    return len([0] * n)\n", inputs: [[10], [200_000_000]] });
    expect(r.outcomes[0]).toMatchObject({ ok: true, out: 10 });
    expect(r.outcomes[1]?.ok).toBe(false);
  });
});

describe("errorSummary", () => {
  it("picks the named error line out of a stack dump", () => {
    expect(errorSummary("/tmp/main.js:1\nfunction f( {\n           ^\n\nSyntaxError: Unexpected token '{'\n    at wrapSafe (node:internal)\n    at main")).toBe("SyntaxError: Unexpected token '{'");
    expect(errorSummary('  File "main.py", line 1\n    def f(\n         ^\nSyntaxError: \'(\' was never closed')).toBe("SyntaxError: '(' was never closed");
    expect(errorSummary("a\nb\nc\nd")).toBe("b\nc\nd");
  });
});

describe("harness program", () => {
  it("rejects entry names that are not identifiers", () => {
    expect(() => buildProgram("python", "", "solve(); import os")).toThrow();
  });

  it("ignores user output that lacks the record marker", () => {
    expect(parseLines('{"ok":true,"out":1}\n\x1eCX{"ok":true,"out":2,"ms":1}\n')).toEqual([{ ok: true, out: 2, ms: 1 }]);
  });

  it("keeps results aligned with inputs when a complete line cannot be read, and drops only a cut-off last line", () => {
    const ok = (out: number) => `\x1eCX{"ok":true,"out":${out},"ms":1}\n`;
    const parsed = parseLines(ok(1) + "\x1eCX{broken\n" + ok(3) + '\x1eCX{"ok":tr');
    expect(parsed).toEqual([{ ok: true, out: 1, ms: 1 }, { ok: false, error: "internal", message: "unreadable result line" }, { ok: true, out: 3, ms: 1 }]);
  });

  it.each(["python", "javascript"] as const)("writes non-finite floats as strings in %s, so later results stay on their inputs", async (language) => {
    const code =
      language === "python"
        ? "def solve(x):\n    return [float('inf'), -float('inf'), float('nan')] if x == 2 else x * 10\n"
        : "function solve(x) { return x === 2 ? [Infinity, -Infinity, NaN] : x * 10; }";
    const r = await local.run({ ...base, language, code, inputs: [[1], [2], [3], [4]] });
    expect(r.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([10, ["Infinity", "-Infinity", "NaN"], 30, 40]);
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
    for (const [x = 0] of inputs as number[][]) {
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
    const ex = new Judge0Executor({ baseUrl: "https://judge0.example.com/", token: "t0k", chunkSize: 10, http: { fetchImpl: fakeJudge0(requests) } });
    const inputs = Array.from({ length: 25 }, (_, i) => [i]);
    const req: RunRequest = { ...base, language: "python", code: "def solve(x):\n    return 2 * x\n", inputs };
    const r = await ex.run(req);
    expect(r.outcomes[12]).toMatchObject({ ok: true, out: 24 });
    expect(r.outcomes[13]).toMatchObject({ ok: false, error: "timeout" });
    expect(r.outcomes[24]).toMatchObject({ ok: true, out: 48 });
    expect(r.outcomes).toHaveLength(25);
    expect(requests[0]).toMatchObject({ language_id: 71, memory_limit: 256 * 1024 });
    expect((requests[0]?.headers as Record<string, string>)["X-Auth-Token"]).toBe("t0k");
    expect(ex.label).toBe("Judge0 (judge0.example.com)");
  });

  it("is built from env only when JUDGE0_URL is set", () => {
    expect(Judge0Executor.fromEnv({})).toBeNull();
    expect(Judge0Executor.fromEnv({ JUDGE0_URL: "https://j.example", JUDGE0_LANG_JAVASCRIPT: "93" })).toBeInstanceOf(Judge0Executor);
  });

  it("surfaces HTTP errors as UpstreamError without retrying a 401", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response("nope", { status: 401 });
    }) as unknown as typeof fetch;
    const ex = new Judge0Executor({ baseUrl: "https://j.example", http: { fetchImpl } });
    await expect(ex.run({ ...base, language: "python", code: "", inputs: [[1]] })).rejects.toThrow(UpstreamError);
    expect(calls).toBe(1);
  });

  it("retries a 503 then succeeds", async () => {
    const requests: Record<string, unknown>[] = [];
    const ok = fakeJudge0(requests);
    let calls = 0;
    const fetchImpl = (async (u: string, init: RequestInit) => (++calls === 1 ? new Response("busy", { status: 503 }) : ok(u, init))) as unknown as typeof fetch;
    const ex = new Judge0Executor({ baseUrl: "https://j.example", http: { fetchImpl, sleep: async () => {} } });
    const r = await ex.run({ ...base, language: "python", code: "", inputs: [[2]] });
    expect(r.outcomes).toEqual([{ ok: true, out: 4, ms: 1 }]);
    expect(calls).toBe(2);
  });

  it("maps compile errors and rejects malformed responses", async () => {
    const reply = (body: unknown) => (async () => Response.json(body, { status: 201 })) as unknown as typeof fetch;
    const compile = new Judge0Executor({ baseUrl: "https://j.example", http: { fetchImpl: reply({ stdout: null, compile_output: Buffer.from("SyntaxError").toString("base64"), status: { id: 6, description: "Compilation Error" } }) } });
    const r = await compile.run({ ...base, language: "python", code: "", inputs: [[1], [2]] });
    expect(r.outcomes.every((o) => !o.ok && o.error === "compile")).toBe(true);
    const weird = new Judge0Executor({ baseUrl: "https://j.example", http: { fetchImpl: reply({ token: "abc" }) } });
    await expect(weird.run({ ...base, language: "python", code: "", inputs: [[1]] })).rejects.toThrow(/unexpected response shape/);
  });

  it("rejects bad configuration", () => {
    expect(() => new Judge0Executor({ baseUrl: "not a url" })).toThrow(ConfigError);
    expect(() => new Judge0Executor({ baseUrl: "file:///etc" })).toThrow(/http/);
    expect(() => Judge0Executor.fromEnv({ JUDGE0_URL: "https://j.example", JUDGE0_LANG_PYTHON: "x" })).toThrow(ConfigError);
  });
});
