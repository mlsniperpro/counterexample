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
 * an empty environment. Isolation between submissions and from the network
 * comes from the container (run it as an unprivileged user, see Dockerfile).
 * Auth: when SANDBOX_TOKEN is set, requests need "X-Auth-Token: <token>" or
 * "Authorization: Bearer <token>" (the header Nebius endpoint auth uses).
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
 * Run one program. Limits are clamped to sane bounds whatever the caller asks.
 * @param {{ language_id: number; source: string; stdin: string; cpuSeconds: number; wallSeconds: number; memoryKb: number }} job
 */
export async function runSubmission(job) {
  const lang = LANGUAGES.find((l) => l.id === job.language_id);
  if (!lang) throw new Error(`unknown language_id ${job.language_id}`);
  const cpu = Math.ceil(clamp(job.cpuSeconds, 1, 30));
  const wallMs = clamp(job.wallSeconds, 1, 60) * 1000;
  const memMb = Math.floor(clamp(job.memoryKb / 1024, 32, 2048));
  const dir = await mkdtemp(join(tmpdir(), "cx-sandbox-"));
  try {
    const file = join(dir, lang.file);
    await writeFile(file, job.source);
    const cmd =
      lang.id === 71
        ? `ulimit -t ${cpu}; ulimit -v ${memMb * 1024}; exec python3 -I "$0"`
        : `ulimit -t ${cpu}; exec node --max-old-space-size=${memMb} --stack-size=4000 "$0"`;
    const child = spawn("bash", ["--noprofile", "--norc", "-c", cmd, file], { cwd: dir, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, NODE_ENV: "production" }, stdio: ["pipe", "pipe", "pipe"] });
    /** @type {Buffer[]} */
    const out = [];
    let outBytes = 0;
    let stderr = "";
    /** @type {"wall" | "output" | null} */
    let killed = null;
    const timer = setTimeout(() => {
      killed = "wall";
      child.kill("SIGKILL");
    }, wallMs);
    child.stdout.on("data", (/** @type {Buffer} */ d) => {
      outBytes += d.length;
      if (outBytes > MAX_OUTPUT_BYTES) {
        killed = "output";
        child.kill("SIGKILL");
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
      child.on("close", (c, s) => resolve([c, s]));
    });
    clearTimeout(timer);
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
  let active = 0;
  /** @type {(() => void)[]} */
  const waiting = [];
  const acquire = () => (active < maxConcurrent ? (active++, Promise.resolve()) : new Promise((r) => waiting.push(() => r(undefined))));
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

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
        await acquire();
        try {
          const result = await runSubmission({
            language_id: body.language_id,
            source,
            stdin: typeof body.stdin === "string" ? Buffer.from(body.stdin, "base64").toString("utf8") : "",
            cpuSeconds: Number(body.cpu_time_limit) || 2,
            wallSeconds: Number(body.wall_time_limit) || 5,
            memoryKb: Number(body.memory_limit) || 256 * 1024,
          });
          return send(201, result);
        } finally {
          release();
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
  const server = createSandboxServer({
    token: process.env.SANDBOX_TOKEN || undefined,
    maxConcurrent: process.env.MAX_CONCURRENT ? Number(process.env.MAX_CONCURRENT) : undefined,
  });
  server.listen(port, "0.0.0.0", () => console.log(`counterexample sandbox listening on :${port}${process.env.SANDBOX_TOKEN ? " (token auth on)" : ""}`));
}
