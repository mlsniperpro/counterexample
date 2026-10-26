import { describe, expect, it } from "vitest";
import { ConfigError, ExecutorError, UpstreamError } from "@/lib/errors";
import { Judge0Executor } from "@/lib/exec/judge0";
import { errorSummary, LocalExecutor } from "@/lib/exec/local";
import { buildProgram, parseLines, runWithRestarts } from "@/lib/exec/program";
import type { RunRequest } from "@/lib/exec/types";
import { outputsEqual, showValue } from "@/lib/core/compare";

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

  it("writes JavaScript BigInt results as exact integers, and compares them by their digits", async () => {
    const code = "function solve(x) { return x === 1 ? 2n ** 70n : [x, -(2n ** 64n), { a: 5n }]; }";
    const r = await local.run({ ...base, language: "javascript", code, inputs: [[1], [3]] });
    const [a, b] = r.outcomes;
    expect(a?.ok && b?.ok).toBe(true);
    if (!a?.ok || !b?.ok) return;
    expect(showValue(a.out)).toBe("1180591620717411303424");
    expect(showValue(b.out)).toBe('[3,-18446744073709551616,{"a":5}]');
    const py = await local.run({ ...base, language: "python", code: "def solve(x):\n    return 2 ** 70 if x == 1 else [x, -(2 ** 64), {'a': 5}]\n", inputs: [[1], [3]] });
    expect(py.outcomes.every((o, i) => o.ok && outputsEqual(o.out, (r.outcomes[i] as { out: unknown }).out))).toBe(true);
  });

  it("writes a JavaScript number beyond 2^53 as its exact digits, so it compares equal to Python's exact integer", async () => {
    const js = buildProgram("javascript", "function solve(x) { return 2 ** x; }", "solve");
    // The generated program carries the escape itself (a NUL marker the harness strips again), not a raw control character.
    expect(js).toContain('"\\u0000BIG" + BigInt(v).toString()');
    const run = (language: "python" | "javascript", code: string) => local.run({ ...base, language, code, inputs: [[60]] }).then((r) => (r.outcomes[0] as { out: unknown }).out);
    const jsOut = await run("javascript", "function solve(x) { return 2 ** x; }");
    expect(showValue(jsOut)).toBe("1152921504606846976");
    expect(outputsEqual(jsOut, await run("python", "def solve(x):\n    return 1 << x\n"))).toBe(true);
    expect(outputsEqual(jsOut, await run("python", "def solve(x):\n    return (1 << x) + 1\n"))).toBe(false);
    // Safe integers, floats and nested values keep their plain form.
    const mixed = await local.run({ ...base, language: "javascript", code: "function solve() { return [2 ** 53 - 1, 1.5, -(2 ** 60), 1e21]; }", inputs: [[]] });
    expect(showValue((mixed.outcomes[0] as { out: unknown }).out)).toBe("[9007199254740991,1.5,-1152921504606846976,1000000000000000000000]");
  });

  it("leaves a string that merely contains a quote, a NUL and BIG<digits> alone, in JavaScript as in Python", async () => {
    const jsCode = "function solve(x) { return x === 0 ? '\"\\u0000BIG5' : x === 1 ? [2 ** 60, '\"\\u0000BIG5', ',\"\\u0000BIG7', 3n] : { k: 'a,\"\\u0000BIG9\"', n: 2n ** 64n }; }";
    const pyCode = "def solve(x):\n    if x == 0:\n        return '\"\\u0000BIG5'\n    if x == 1:\n        return [2 ** 60, '\"\\u0000BIG5', ',\"\\u0000BIG7', 3]\n    return {'k': 'a,\"\\u0000BIG9\"', 'n': 2 ** 64}\n";
    const inputs = [[0], [1], [2]];
    const js = await local.run({ ...base, language: "javascript", code: jsCode, inputs });
    const py = await local.run({ ...base, language: "python", code: pyCode, inputs });
    expect(js.outcomes.map((o) => o.ok)).toEqual([true, true, true]);
    expect((js.outcomes[0] as { out: unknown }).out).toBe('"\u0000BIG5');
    expect(js.outcomes.every((o, i) => o.ok && py.outcomes[i]?.ok && outputsEqual(o.out, (py.outcomes[i] as { out: unknown }).out))).toBe(true);
  });

  it("anchors the harness's digit rewrite to values, so the generated JavaScript only rewrites a marker standing as a JSON value", () => {
    const js = buildProgram("javascript", "function solve(x) { return x; }", "solve");
    const at = js.indexOf("const __digits = ");
    const rewrite = new Function(`${js.slice(at, js.indexOf("\n", at))}; return __digits;`)() as (s: string) => string;
    expect(rewrite('{"ok":true,"out":["\\u0000BIG12",{"k":"\\u0000BIG-3"}]}')).toBe('{"ok":true,"out":[12,{"k":-3}]}');
    expect(rewrite('{"out":"\\"\\u0000BIG5"}')).toBe('{"out":"\\"\\u0000BIG5"}');
    expect(rewrite('{"out":["a,\\"\\u0000BIG5"]}')).toBe('{"out":["a,\\"\\u0000BIG5"]}');
  });

  it("writes each input's time rounded to 3 decimals in both harnesses, so record lines stay short and carry no 16-digit fraction", async () => {
    const inputs = Array.from({ length: 30 }, (_, i) => [i]);
    for (const [language, code] of [
      ["python", "def solve(x):\n    return x * 3\n"],
      ["javascript", "function solve(x) { return x * 3; }"],
    ] as const) {
      const r = await local.run({ ...base, language, code, inputs });
      const decimals = r.outcomes.map((o) => (o.ok ? (String(o.ms).split(".")[1] ?? "").length : -1));
      expect(decimals.every((d) => d >= 0 && d <= 3)).toBe(true);
    }
  });

  it("times JavaScript inputs with perf_hooks, which Judge0 CE's default Node 12 has (it has no global performance)", () => {
    const js = buildProgram("javascript", "function solve(x) { return x; }", "solve");
    expect(js).toContain('require("perf_hooks").performance');
    expect(js).not.toMatch(/[^.]performance\.now\(/);
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
