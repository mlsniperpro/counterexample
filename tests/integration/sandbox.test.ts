import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Judge0Executor } from "@/lib/exec/judge0";
import { createSandboxServer, probeNetworkFilter, runSubmission } from "../../sandbox/server.mjs";

type Srv = ReturnType<typeof createSandboxServer>;
const listen = async (s: Srv) => {
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
};
const close = (s: Srv) => new Promise<void>((r) => s.close(() => r()));
const b64 = (s: string) => Buffer.from(s).toString("base64");
const unb64 = (s: string | null) => (s ? Buffer.from(s, "base64").toString() : "");

// Runs are killed by uid, so every test process gets its own uid range: concurrent runs of this file cannot kill each other's runs.
const UID_BASE = 1_000_000 + (process.pid % 100_000) * 16;
const asRoot = process.getuid?.() === 0;

let server: Srv;
let url: string;
beforeAll(async () => {
  server = createSandboxServer({ token: "s3cret", maxConcurrent: 2, uidBase: UID_BASE });
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
    const job = { language_id: 71, source, stdin: "", cpuSeconds: 2, wallSeconds: 5, memoryKb: 256 * 1024, uid: UID_BASE + 8 };
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
    const small = createSandboxServer({ maxConcurrent: 1, maxQueue: 0, uidBase: UID_BASE + 4 });
    const u = await listen(small);
    try {
      const slow = { source_code: b64("import time\ntime.sleep(2)"), language_id: 71, stdin: b64(""), cpu_time_limit: 2, wall_time_limit: 6 };
      const send = () => fetch(`${u}/submissions?base64_encoded=true&wait=true`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(slow) });
      const first = send();
      // Send the second only once the first holds the slot: a fixed delay is not enough on a loaded machine.
      const deadline = Date.now() + 10_000;
      while ((await (await fetch(`${u}/health`)).json()).active !== 1) {
        if (Date.now() > deadline) throw new Error("the first submission never took the sandbox's slot");
        await new Promise((r) => setTimeout(r, 10));
      }
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

describe("sandbox isolation", () => {
  const job = { stdin: "", cpuSeconds: 5, wallSeconds: 10, memoryKb: 64 * 1024 } as const;
  const isolatedJob = asRoot ? { uid: UID_BASE + 9 } : {};

  it("denies every POSIX message-queue call, so no queue can outlive a run", async () => {
    // mq_unlink, mq_timedsend, mq_timedreceive, mq_notify, mq_getsetattr: with a bad descriptor the kernel says EBADF (9) or ENOENT (2); the filter says EACCES (13).
    const py = [
      "import ctypes, errno, os, platform",
      "libc = ctypes.CDLL(None, use_errno=True)",
      "nrs = {'x86_64': [241, 242, 243, 244, 245], 'aarch64': [181, 182, 183, 184, 185]}[platform.machine()]",
      "for nr in nrs:",
      "    r = libc.syscall(nr, -1, 0, 0, 0, 0)",
      "    print(nr, 'denied' if r == -1 and ctypes.get_errno() == errno.EACCES else 'allowed')",
    ].join("\n");
    const p = await runSubmission({ ...job, ...isolatedJob, language_id: 71, source: py });
    const lines = unb64(p.stdout).trim().split("\n");
    expect(lines).toHaveLength(5);
    expect(lines.every((l) => l.endsWith(" denied"))).toBe(true);
  });

  it("denies submitted code every socket: metadata, a neighbouring sandbox, the internet and loopback", async () => {
    expect(await probeNetworkFilter()).toBe("blocked");
    const targets = [["169.254.169.254", 80], ["172.17.0.1", 2358], ["93.184.215.14", 80], ["127.0.0.1", Number(new URL(url).port)]];
    const py = [
      "import socket",
      `for host, port in ${JSON.stringify(targets)}:`,
      "    try:",
      "        socket.create_connection((host, port), timeout=2)",
      "        print(host, 'connected')",
      "    except PermissionError:",
      "        print(host, 'denied')",
    ].join("\n");
    const p = await runSubmission({ ...job, ...isolatedJob, language_id: 71, source: py });
    expect(unb64(p.stdout).trim().split("\n")).toEqual(targets.map(([h]) => `${h} denied`));
    const js = `const net = require("net");
(async () => {
  for (const [h, p] of ${JSON.stringify(targets)}) {
    console.log(h, await new Promise((r) => { const s = net.connect(p, h); s.on("connect", () => { s.destroy(); r("connected"); }); s.on("error", (e) => r(e.code)); }));
  }
  console.log("fetch", await fetch("http://93.184.215.14/").then(() => "connected", (e) => e.cause?.code ?? e.message));
})();`;
    const j = await runSubmission({ ...job, ...isolatedJob, memoryKb: 256 * 1024, language_id: 63, source: js });
    expect(unb64(j.stdout).trim().split("\n")).toEqual([...targets.map(([h]) => `${h} EACCES`), "fetch EACCES"]);
    expect(j.status.id).toBe(3);
  });

  it("reports the isolation it has in /health", async () => {
    const h = await (await fetch(`${url}/health`)).json();
    expect(h).toMatchObject({ ok: true, isolation: { uid: asRoot, network: "blocked" } });
  });

  it("stops a Node Buffer bomb: the address-space limit applies to Node too", async () => {
    const source = "const keep = []; let mb = 0; try { for (;;) { keep.push(Buffer.alloc(64 << 20, 1)); mb += 64; } } catch (e) { console.log(mb); }";
    const r = await runSubmission({ ...job, ...isolatedJob, language_id: 63, source });
    // Either the allocation fails (well below the 3.1 GB seen without the limit) or the run is killed.
    if (r.status.id === 3) expect(Number(unb64(r.stdout))).toBeLessThan(1024);
    else expect(r.status.id).toBe(11);
  });

  it("limits memory per run, not per process: forked children share one budget", async () => {
    const source = [
      "import os, time",
      "for _ in range(20):",
      "    if os.fork() == 0:",
      "        b = bytearray(40 * 1024 * 1024)",
      "        time.sleep(5)",
      "        os._exit(0)",
      "time.sleep(4)",
      "print('survived')",
    ].join("\n");
    const r = await runSubmission({ ...job, ...isolatedJob, language_id: 71, source });
    expect(r.status.id).toBe(11);
    expect(unb64(r.stderr)).toMatch(/memory limit 64 MB exceeded/);
  });

  it("caps file size, and leaves nothing behind for the next user", async () => {
    const marker = `/tmp/cx-leftover-${process.pid}`;
    const source = [
      "import os",
      `open("${marker}", "wb").write(b"x")`,
      "try:",
      `    open("${marker}-big", "wb").write(b"x" * (32 * 1024 * 1024))`,
      "    print('big written')",
      "except OSError as e:",
      "    print('big', e.errno)",
      "try:",
      "    open('here', 'wb')",
      "    print('cwd writable')",
      "except OSError:",
      "    print('cwd read-only')",
    ].join("\n");
    const r = await runSubmission({ ...job, ...isolatedJob, language_id: 71, source });
    const lines = unb64(r.stdout).trim().split("\n");
    expect(lines[0]).toBe("big 27"); // EFBIG: ulimit -f
    if (!asRoot) return; // without root the run is the server's uid: nothing to sweep by owner, nothing to lock
    expect(lines[1]).toBe("cwd read-only");
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(`${marker}-big`)).toBe(false);
  });
});

describe("sandbox entry point", () => {
  /** Start `node sandbox/server.mjs` with this env; resolves with its first output line, or its exit code. */
  const start = (env: Record<string, string>) =>
    new Promise<{ line: string; code: number | null }>((resolve) => {
      const p = spawn(process.execPath, ["sandbox/server.mjs"], {
        env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", PORT: "0", SANDBOX_UID_BASE: String(UID_BASE + 12), ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      const onData = (d: Buffer) => {
        out += d.toString();
        if (/listening on/.test(out)) {
          p.kill();
          resolve({ line: out.split("\n").find((l) => /listening/.test(l)) ?? out, code: null });
        }
      };
      p.stdout.on("data", onData);
      p.stderr.on("data", (d: Buffer) => (out += d.toString()));
      p.on("exit", (code) => resolve({ line: out.trim(), code }));
    });

  it("listens on localhost only without a token, on every interface with one", async () => {
    expect((await start({})).line).toMatch(/listening on 127\.0\.0\.1:\d+ \(no SANDBOX_TOKEN: local only\); network for runs: blocked/);
    expect((await start({ SANDBOX_TOKEN: "t" })).line).toMatch(/listening on 0\.0\.0\.0:\d+ \(token auth on\)/);
  });

  it("refuses to start in the image without a token", async () => {
    expect(await start({ CX_SANDBOX_IMAGE: "1" })).toEqual({ line: "SANDBOX_TOKEN is required in the container image", code: 1 });
  });
});
