// @ts-check
/**
 * Counterexample sandbox: a small Judge0-compatible code runner (the subset
 * Judge0Executor uses), Node standard library only, packaged as a container
 * (sandbox/Dockerfile) to run as a Nebius Serverless AI endpoint or anywhere
 * Docker runs.
 *
 *   POST /submissions?base64_encoded=true&wait=true  {source_code, language_id, stdin, cpu_time_limit, wall_time_limit, memory_limit}
 *   GET  /languages                                   [{id, name}]
 *   GET  /health                                      {ok, active, queued}
 *
 * Each submission runs in a fresh temp directory as a child process with a
 * CPU-time limit (ulimit -t), a memory limit (ulimit -v for Python,
 * --max-old-space-size for Node), a wall-clock limit, a 32 MB output cap and
 * an empty environment. When the server runs as root (the container image),
 * every run slot has its own unprivileged uid: the run's directory is private
 * to it, it may own at most MAX_PROCS processes, it cannot read the server's
 * environment, and every process it owns is killed when the run ends, so a
 * forked child cannot outlive the run or touch another submission. Without
 * root (a local `pnpm sandbox`) runs share the server's uid and only the
 * process group is killed: that mode is for development, and says so at start.
 * Auth: when SANDBOX_TOKEN is set, requests need "X-Auth-Token: <token>" or
 * "Authorization: Bearer <token>" (the header Nebius endpoint auth uses).
 */
import { spawn } from "node:child_process";
import { chmod, chown, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";

export const LANGUAGES = [
  { id: 63, name: "JavaScript (Node.js, Counterexample sandbox)", file: "main.js" },
  { id: 71, name: "Python (3, Counterexample sandbox)", file: "main.py" },
];

const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
/** Processes one run uid may own (ulimit -u): stops fork bombs. */
const MAX_PROCS = 64;
/** First uid of the per-slot run users; slot i runs as RUN_UID_BASE + i. */
export const RUN_UID_BASE = 20000;
/** After the program exits and its processes are killed, how long to wait for its pipes to close. */
const DRAIN_MS = 1000;
const isRoot = () => process.getuid?.() === 0;
const STATUS = {
  accepted: { id: 3, description: "Accepted" },
  tle: { id: 5, description: "Time Limit Exceeded" },
  nzec: { id: 11, description: "Runtime Error (NZEC)" },
  internal: { id: 13, description: "Internal Error" },
};

/** @param {number} x @param {number} lo @param {number} hi */
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
/** @param {string} s */
const b64 = (s) => (s ? Buffer.from(s, "utf8").toString("base64") : null);

/**
 * Kill every process of a run: all processes owned by its uid (kill -1 as that
 * uid reaches each of them, including ones that left the process group), or
 * the process group when runs share the server's uid.
 * Resolves once the uid sweep has finished, so the slot's uid is clean before the next run gets it.
 * @param {import("node:child_process").ChildProcess} child @param {number | undefined} uid
 * @returns {Promise<void>}
 */
function killRun(child, uid) {
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {
    // The group is already gone.
  }
  if (uid === undefined) return Promise.resolve();
  return new Promise((resolve) => {
    const sweep = spawn("bash", ["--noprofile", "--norc", "-c", "kill -KILL -1"], { uid, gid: uid, stdio: "ignore", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "production" } });
    sweep.on("error", () => resolve());
    sweep.on("exit", () => resolve());
  });
}

/**
 * Run one program. Limits are clamped to sane bounds whatever the caller asks.
 * `uid` (root only) is the run slot's unprivileged user.
 * @param {{ language_id: number; source: string; stdin: string; cpuSeconds: number; wallSeconds: number; memoryKb: number; uid?: number }} job
 */
export async function runSubmission(job) {
  const lang = LANGUAGES.find((l) => l.id === job.language_id);
  if (!lang) throw new Error(`unknown language_id ${job.language_id}`);
  const cpu = Math.ceil(clamp(job.cpuSeconds, 1, 30));
  const wallMs = clamp(job.wallSeconds, 1, 60) * 1000;
  const memMb = Math.floor(clamp(job.memoryKb / 1024, 32, 2048));
  const uid = job.uid;
  const dir = await mkdtemp(join(tmpdir(), "cx-sandbox-"));
  try {
    const file = join(dir, lang.file);
    await writeFile(file, job.source);
    if (uid !== undefined) {
      await chown(dir, uid, uid);
      await chown(file, uid, uid);
      await chmod(dir, 0o700);
    }
    const limits = `ulimit -t ${cpu}; ${uid !== undefined ? `ulimit -u ${MAX_PROCS}; ` : ""}`;
    const cmd =
      lang.id === 71
        ? `${limits}ulimit -v ${memMb * 1024}; exec python3 -I "$0"`
        : `${limits}exec node --max-old-space-size=${memMb} --stack-size=4000 "$0"`;
    const child = spawn("bash", ["--noprofile", "--norc", "-c", cmd, file], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, NODE_ENV: "production" },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      ...(uid !== undefined ? { uid, gid: uid } : {}),
    });
    const closed = new Promise((resolve) => child.on("close", resolve));
    /** @type {Buffer[]} */
    const out = [];
    let outBytes = 0;
    let stderr = "";
    /** @type {"wall" | "output" | null} */
    let killed = null;
    const timer = setTimeout(() => {
      killed = "wall";
      void killRun(child, uid);
    }, wallMs);
    child.stdout.on("data", (/** @type {Buffer} */ d) => {
      outBytes += d.length;
      if (outBytes > MAX_OUTPUT_BYTES) {
        killed = "output";
        void killRun(child, uid);
      } else out.push(d);
    });
    child.stderr.on("data", (/** @type {Buffer} */ d) => {
      if (stderr.length < 20_000) stderr += d.toString();
    });
    child.stdin.on("error", () => {});
    child.stdin.end(job.stdin);
    const started = Date.now();
    /** @type {[number | null, NodeJS.Signals | null]} */
    const [code, signal] = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (c, s) => resolve([c, s]));
    });
    clearTimeout(timer);
    // The program is done: nothing it started may outlive it. Then wait (bounded) for its pipes to drain.
    await killRun(child, uid);
    let drain;
    await Promise.race([closed, new Promise((resolve) => (drain = setTimeout(resolve, DRAIN_MS)))]);
    clearTimeout(drain);
    child.stdout.destroy();
    child.stderr.destroy();
    const stdout = Buffer.concat(out).toString("utf8");
    // ulimit -t ends a CPU-bound process with SIGXCPU (or SIGKILL at the hard limit).
    const tle = killed === "wall" || signal === "SIGXCPU" || (signal === "SIGKILL" && killed === null);
    const status = tle ? STATUS.tle : killed === "output" ? STATUS.nzec : code === 0 ? STATUS.accepted : STATUS.nzec;
    return {
      stdout: b64(stdout),
      stderr: b64(killed === "output" ? `output limit ${MAX_OUTPUT_BYTES} bytes exceeded\n${stderr}` : stderr),
      compile_output: null,
      message: signal ? b64(`killed by ${signal}`) : null,
      status,
      time: ((Date.now() - started) / 1000).toFixed(3),
      memory: null,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** @param {string | undefined} a @param {string} b */
function sameToken(a, b) {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * @param {{ token?: string; maxConcurrent?: number; maxQueue?: number }} [opts]
 */
export function createSandboxServer(opts = {}) {
  const maxConcurrent = opts.maxConcurrent ?? Math.max(1, availableParallelism());
  const maxQueue = opts.maxQueue ?? maxConcurrent * 8;
  // Run slots; as root each slot is a uid of its own, so concurrent runs cannot see each other.
  const free = Array.from({ length: maxConcurrent }, (_, i) => i);
  let active = 0;
  /** @type {((slot: number) => void)[]} */
  const waiting = [];
  /** @returns {Promise<number>} */
  const acquire = () => {
    const slot = free.pop();
    if (slot !== undefined) {
      active++;
      return Promise.resolve(slot);
    }
    return new Promise((r) => waiting.push(r));
  };
  /** @param {number} slot */
  const release = (slot) => {
    const next = waiting.shift();
    if (next) next(slot);
    else {
      active--;
      free.push(slot);
    }
  };
  const isolated = isRoot();

  return createServer(async (req, res) => {
    /** @param {number} status @param {unknown} body @param {Record<string, string>} [headers] */
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://sandbox");
      if (url.pathname === "/health" && req.method === "GET") return send(200, { ok: true, active, queued: waiting.length });
      if (opts.token) {
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
        const header = req.headers["x-auth-token"];
        if (!sameToken(typeof header === "string" ? header : bearer, opts.token)) return send(401, { error: "unauthorized" });
      }
      if (url.pathname === "/languages" && req.method === "GET") return send(200, LANGUAGES.map(({ id, name }) => ({ id, name })));
      if (url.pathname === "/submissions" && req.method === "POST") {
        if (url.searchParams.get("base64_encoded") !== "true" || url.searchParams.get("wait") !== "true") {
          return send(400, { error: "only base64_encoded=true&wait=true is supported" });
        }
        // Busy only when every run slot is taken and the queue is full.
        if (active >= maxConcurrent && waiting.length >= maxQueue) return send(503, { error: "sandbox busy" }, { "retry-after": "1" });
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > MAX_BODY_BYTES) return send(413, { error: "request too large" });
          chunks.push(c);
        }
        /** @type {any} */
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return send(400, { error: "body is not JSON" });
        }
        if (typeof body?.source_code !== "string" || typeof body?.language_id !== "number") return send(422, { error: "source_code and language_id are required" });
        const source = Buffer.from(body.source_code, "base64").toString("utf8");
        if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) return send(422, { error: "source too large" });
        if (!LANGUAGES.some((l) => l.id === body.language_id)) return send(422, { error: `unknown language_id ${body.language_id}` });
        const slot = await acquire();
        try {
          const result = await runSubmission({
            uid: isolated ? RUN_UID_BASE + slot : undefined,
            language_id: body.language_id,
            source,
            stdin: typeof body.stdin === "string" ? Buffer.from(body.stdin, "base64").toString("utf8") : "",
            cpuSeconds: Number(body.cpu_time_limit) || 2,
            wallSeconds: Number(body.wall_time_limit) || 5,
            memoryKb: Number(body.memory_limit) || 256 * 1024,
          });
          return send(201, result);
        } finally {
          release(slot);
        }
      }
      send(404, { error: `no route ${req.method} ${url.pathname}` });
    } catch (e) {
      send(500, { stdout: null, stderr: b64(String(e)), compile_output: null, message: null, status: STATUS.internal });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 2358);
  const token = process.env.SANDBOX_TOKEN || undefined;
  delete process.env.SANDBOX_TOKEN;
  const server = createSandboxServer({
    token,
    maxConcurrent: process.env.MAX_CONCURRENT ? Number(process.env.MAX_CONCURRENT) : undefined,
  });
  if (!isRoot()) console.warn("not running as root: submissions share the server's uid and are NOT isolated from each other (development only; use the container image)");
  server.listen(port, "0.0.0.0", () => console.log(`counterexample sandbox listening on :${port}${token ? " (token auth on)" : ""}`));
}
