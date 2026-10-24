import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Judge0Executor } from "@/lib/exec/judge0";
import { RUN_UID_BASE, createSandboxServer, runSubmission } from "../../sandbox/server.mjs";

type Srv = ReturnType<typeof createSandboxServer>;
const listen = async (s: Srv) => {
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
};
const close = (s: Srv) => new Promise<void>((r) => s.close(() => r()));
const b64 = (s: string) => Buffer.from(s).toString("base64");
const unb64 = (s: string | null) => (s ? Buffer.from(s, "base64").toString() : "");

let server: Srv;
let url: string;
beforeAll(async () => {
  server = createSandboxServer({ token: "s3cret", maxConcurrent: 2 });
  url = await listen(server);
});
afterAll(async () => close(server));

const base = { entry: "solve", timeLimitMs: 500, memoryLimitMb: 256 } as const;

describe("Counterexample sandbox (Judge0-compatible) behind Judge0Executor", () => {
  const exec = () => new Judge0Executor({ baseUrl: url, token: "s3cret", auth: "bearer", chunkSize: 50 });

  it("runs the harness in both languages and returns one outcome per input", async () => {
    const py = await exec().run({ ...base, language: "python", code: "def solve(a, b):\n    print('noise')\n    return a * b\n", inputs: [[2, 3], [4, 5]] });
    expect(py.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([6, 20]);
    const js = await exec().run({ ...base, language: "javascript", code: "function solve(s) { return s.toUpperCase(); }", inputs: [["ab"], [""]] });
    expect(js.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual(["AB", ""]);
  });

  it("blames a hang on the right input and finishes the rest (CPU limit)", async () => {
    const code = "def solve(x):\n    while x == 2:\n        pass\n    return x\n";
    const r = await exec().run({ ...base, language: "python", code, inputs: [[1], [2], [3]] });
    expect(r.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([1, "timeout", 3]);
  });

  it("reports syntax errors as compile errors and runtime errors per input", async () => {
    const bad = await exec().run({ ...base, language: "javascript", code: "function solve( {", inputs: [[1], [2]] });
    expect(bad.outcomes.every((o) => !o.ok && o.error === "compile")).toBe(true);
    const rt = await exec().run({ ...base, language: "python", code: "def solve(x):\n    return 1 // x\n", inputs: [[1], [0], [2]] });
    expect(rt.outcomes.map((o) => (o.ok ? o.out : o.error))).toEqual([1, "runtime", 0]);
  });

  it("enforces the memory limit", async () => {
    const r = await exec().run({ ...base, memoryLimitMb: 64, language: "python", code: "def solve(n):\n    return len(bytearray(n))\n", inputs: [[10], [500_000_000]] });
    expect(r.outcomes[0]).toMatchObject({ ok: true, out: 10 });
    expect(r.outcomes[1]?.ok).toBe(false);
  });

  it("gives user code only a minimal environment (no server variables or secrets)", async () => {
    process.env.CX_SANDBOX_SECRET = "leak";
    const allowed = ["HOME", "LC_CTYPE", "NODE_ENV", "OLDPWD", "PATH", "PWD", "SHLVL", "_"];
    try {
      for (const [language, code] of [
        ["javascript", "function solve() { return Object.keys(process.env); }"],
        ["python", "import os\ndef solve():\n    return sorted(os.environ)\n"],
      ] as const) {
        const r = await exec().run({ ...base, language, code, inputs: [[]] });
        const keys = r.outcomes[0]?.ok ? (r.outcomes[0].out as string[]) : ["(failed)"];
        expect(keys.filter((k) => !allowed.includes(k)), language).toEqual([]);
      }
    } finally {
      delete process.env.CX_SANDBOX_SECRET;
    }
  });
});

describe("sandbox HTTP API", () => {
  const post = (body: unknown, headers: Record<string, string> = { "x-auth-token": "s3cret" }, query = "?base64_encoded=true&wait=true") =>
    fetch(`${url}/submissions${query}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

  it("requires the token (X-Auth-Token or Bearer) except for /health", async () => {
    expect((await fetch(`${url}/health`)).status).toBe(200);
    expect((await fetch(`${url}/languages`)).status).toBe(401);
    expect((await fetch(`${url}/languages`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    const langs = await (await fetch(`${url}/languages`, { headers: { authorization: "Bearer s3cret" } })).json();
    expect(langs.map((l: { id: number }) => l.id)).toEqual([63, 71]);
    expect((await post({ source_code: b64("x"), language_id: 71 }, {})).status).toBe(401);
  });

  it("rejects malformed requests with 4xx, not a crash", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ language_id: 71 })).status).toBe(422);
    expect((await post({ source_code: b64("x"), language_id: 99 })).status).toBe(422);
    expect((await post({ source_code: b64("x".repeat(300_000)), language_id: 71 })).status).toBe(422);
    expect((await post({ source_code: b64("x"), language_id: 71 }, undefined, "?wait=true")).status).toBe(400);
    expect((await fetch(`${url}/nope`, { headers: { "x-auth-token": "s3cret" } })).status).toBe(404);
  });

  it("caps output and wall time whatever the client asks", async () => {
    const big = await runSubmission({ language_id: 71, source: "print('x' * 40_000_000)", stdin: "", cpuSeconds: 5, wallSeconds: 10, memoryKb: 512 * 1024 });
    expect(big.status.id).toBe(11);
    expect(unb64(big.stderr)).toMatch(/output limit/);
    const sleepy = await runSubmission({ language_id: 63, source: "setTimeout(() => {}, 60000)", stdin: "", cpuSeconds: 1, wallSeconds: 0.1, memoryKb: 256 * 1024 });
    expect(sleepy.status.id).toBe(5);
  });

  it("ends a run on time even when the program forks a child that holds its pipes", async () => {
    const source = "import os, time\nif os.fork() == 0:\n    time.sleep(30)\nwhile True:\n    pass\n";
    const t0 = Date.now();
    const r = await runSubmission({ language_id: 71, source, stdin: "", cpuSeconds: 1, wallSeconds: 1, memoryKb: 256 * 1024 });
    expect(r.status.id).toBe(5);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("as root, runs each slot as its own uid: no reading the server's environment, no process outliving the run", async () => {
    // A child that leaves the process group, then reports its pid; the program itself exits cleanly.
    const source = [
      "import os, sys, time",
      "try:",
      "    open(f'/proc/{os.getppid()}/environ').read()",
      "    print('environ readable')",
      "except OSError:",
      "    print('environ denied')",
      "pid = os.fork()",
      "if pid == 0:",
      "    os.setsid()",
      "    time.sleep(30)",
      "    sys.exit(0)",
      "print(pid)",
    ].join("\n");
    const job = { language_id: 71, source, stdin: "", cpuSeconds: 2, wallSeconds: 5, memoryKb: 256 * 1024, uid: RUN_UID_BASE };
    if (process.getuid?.() !== 0) {
      // Without root a run cannot switch uid, and says so instead of running unisolated.
      await expect(runSubmission(job)).rejects.toThrow(/EPERM|operation not permitted/i);
      return;
    }
    const r = await runSubmission(job);
    expect(r.status.id).toBe(3);
    const [verdict, forked] = unb64(r.stdout).trim().split("\n");
    expect(verdict).toBe("environ denied");
    const state = await readFile(`/proc/${forked}/status`, "utf8").then((t) => /^State:\s+(\w)/m.exec(t)?.[1], () => "gone");
    expect(["gone", "Z"]).toContain(state);
  });

  it("returns 503 with Retry-After when the queue is full, and the client retries", async () => {
    const small = createSandboxServer({ maxConcurrent: 1, maxQueue: 0 });
    const u = await listen(small);
    try {
      const slow = { source_code: b64("import time\ntime.sleep(0.5)"), language_id: 71, stdin: b64(""), cpu_time_limit: 2, wall_time_limit: 3 };
      const send = () => fetch(`${u}/submissions?base64_encoded=true&wait=true`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(slow) });
      const first = send();
      await new Promise((r) => setTimeout(r, 100));
      const second = await send();
      expect(second.status).toBe(503);
      expect(second.headers.get("retry-after")).toBe("1");
      expect((await first).status).toBe(201);
      // Judge0Executor's retry policy rides out a busy sandbox.
      const ex = new Judge0Executor({ baseUrl: u, chunkSize: 10 });
      const results = await Promise.all([1, 2].map((x) => ex.run({ ...base, language: "python", code: "def solve(x):\n    return x\n", inputs: [[x]] })));
      expect(results.map((r) => r.outcomes[0])).toEqual([expect.objectContaining({ out: 1 }), expect.objectContaining({ out: 2 })]);
    } finally {
      await close(small);
    }
  });
});
