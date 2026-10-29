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
 * CPU-time limit (ulimit -t), a per-process address-space limit (RLIMIT_AS,
 * sized for V8's reservations under Node), a per-run memory limit (the RSS of
 * all its processes, sampled), a file-size and open-file limit, a wall-clock
 * limit, an 8 MB output cap and an empty environment. A seccomp filter
 * (installed by a small Python launcher; no capability needed, so it works in
 * a plain `docker run`) makes socket(), memfd_create(), SysV/POSIX IPC and
 * io_uring fail, so submitted code has no network at all, loopback included.
 * The server checks at start that the filter works, reports it in /health,
 * and refuses submissions if it does not (unless SANDBOX_ALLOW_NETWORK=1).
 * When the server runs as root (the container image), every run slot has its
 * own unprivileged uid: the run's directory is readable only by it and
 * writable by nobody, it may own at most MAX_PROCS processes, it cannot read
 * the server's environment, every process it owns is killed when the run
 * ends, and anything it left in the shared temp dirs is deleted, so a forked
 * child or a file cannot outlive the run or touch another submission. Without
 * root (a local `pnpm sandbox`) runs share the server's uid and only the
 * process group is killed: that mode is for development, and says so at start.
 * Auth: when SANDBOX_TOKEN is set, requests need "X-Auth-Token: <token>" or
 * "Authorization: Bearer <token>" (the header Nebius endpoint auth uses).
 * Without a token the server listens on 127.0.0.1 only; the image requires one.
 */
import { spawn } from "node:child_process";
import { chmod, chown, lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
/** Processes (threads included) one run uid may own (ulimit -u): stops fork bombs. */
const MAX_PROCS = 64;
/** Largest file a run may write (ulimit -f, KB), and how many files it may hold open (ulimit -n). */
const MAX_FILE_KB = 16 * 1024;
const MAX_FDS = 256;
/**
 * Node reserves far more address space than it uses (measured on Node 22: it
 * needs about 750 MB of RLIMIT_AS to start, and heap + ~800 MB to fill its
 * heap), so its limit is a base plus 1.25 x the heap. The real bound is the
 * per-run RSS limit below. --disable-wasm-trap-handler makes WebAssembly (which
 * fetch() uses) bounds-check instead of reserving a 10 GB guard region per memory.
 */
const NODE_AS_BASE_MB = 1024;
/** A run is killed when its processes' RSS together exceeds memory_limit plus this (an idle Node is ~45 MB). */
const RSS_SLACK_MB = 64;
const RSS_SAMPLE_MS = 50;
/** Default first uid of the per-slot run users; slot i runs as base + i (SANDBOX_UID_BASE overrides it). */
export const RUN_UID_BASE = 20000;
/** World-writable temp dirs a run uid might leave files in (swept after each run, locked in the image). */
// /dev/mqueue: POSIX message queues are files there, and would otherwise outlive a run.
const SHARED_DIRS = [...new Set([tmpdir(), "/tmp", "/dev/shm", "/var/tmp", "/dev/mqueue"])];
/** Exit code of the launcher when it cannot set up the run (the filter did not install). */
const LAUNCH_FAILED = 125;
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
 * Syscalls a run may not make, by Node's process.arch: socket (all network,
 * loopback and AF_UNIX included), socketpair (its kernel send buffers are memory
 * no run's RSS counts: 120 filled pairs held about 900 MB), inotify (unread event
 * queues are kernel memory too, about 85 MB per run), memfd_create,
 * shmget, semget, msgget, every POSIX message-queue call (mq_open, mq_unlink,
 * mq_timedsend, mq_timedreceive, mq_notify, mq_getsetattr: a queue can also be
 * created with a plain open() under /dev/mqueue, so send and receive are denied
 * too), io_uring_{setup,enter,register}, the legacy AIO calls (io_setup etc.: one run could fill the host-global aio-nr and starve other containers), unshare, setns, mount, pivot_root and
 * chroot (a user namespace with its own tmpfs holds memory the run's limit does
 * not count, wherever the runtime's own seccomp profile is missing), and fork,
 * vfork and any clone that does not set CLONE_THREAD (a run is then one process,
 * whose single RLIMIT_AS bounds its memory; without this, 64 forked children
 * could each reserve memory_limit and reach the whole container's memory before
 * the RSS sampler catches up, killing other runs). Threads stay allowed:
 * clone with CLONE_THREAD passes, and clone3 returns ENOSYS so the C library
 * falls back to the checked clone. `clone`/`clone3` go through the flag check
 * below, not the flat list.
 */
const DENIED_SYSCALLS = {
  x64: { audit: 0xc000003e, x32: true, clone: 56, nrs: [57, 58, 41, 53, 253, 254, 294, 319, 29, 64, 68, 240, 241, 242, 243, 244, 245, 425, 426, 427, 272, 308, 165, 155, 161, 206, 207, 208, 209, 210] },
  arm64: { audit: 0xc00000b7, x32: false, clone: 220, nrs: [198, 199, 26, 27, 279, 194, 190, 186, 180, 181, 182, 183, 184, 185, 425, 426, 427, 97, 268, 40, 41, 51, 0, 1, 2, 3, 4] },
};

/**
 * The Python launcher every run starts through: argv is [as_kb, filter (0|1), command...].
 * It sets RLIMIT_AS, then (if asked) PR_SET_NO_NEW_PRIVS and a seccomp BPF
 * filter that fails the denied syscalls with EACCES (and every syscall of a
 * foreign ABI: i386, x32), then execs the command. The filter is inherited by
 * every child and survives exec. Null on an architecture we have no syscall table for.
 */
const LAUNCHER = (() => {
  const t = DENIED_SYSCALLS[/** @type {keyof typeof DENIED_SYSCALLS} */ (process.arch)];
  if (!t) return null;
  return `import ctypes, os, resource, struct, sys
as_kb, use_filter, argv = int(sys.argv[1]), sys.argv[2] == "1", sys.argv[3:]
if as_kb > 0:
    resource.setrlimit(resource.RLIMIT_AS, (as_kb * 1024, as_kb * 1024))
if use_filter:
    NRS, CLONE, CLONE3, CLONE_THREAD = ${JSON.stringify(t.nrs)}, ${t.clone}, 435, 0x00010000
    op = lambda code, jt, jf, k: struct.pack("=HBBI", code, jt, jf, k)
    DENY, ENOSYS, ALLOW = 0x00050000 | 13, 0x00050000 | 38, 0x7FFF0000
    prog = [op(0x20, 0, 0, 4), op(0x15, 1, 0, ${t.audit}), op(0x06, 0, 0, DENY), op(0x20, 0, 0, 0)]
    # A = nr. clone3 -> ENOSYS so the C library retries thread creation with clone (which the next block checks).
    prog += [op(0x15, 0, 1, CLONE3), op(0x06, 0, 0, ENOSYS)]
    # clone: allow only with CLONE_THREAD (a thread); any other clone makes a new process, so deny it.
    prog += [op(0x15, 0, 4, CLONE), op(0x20, 0, 0, 16), op(0x54, 0, 0, CLONE_THREAD), op(0x15, 0, 1, 0), op(0x06, 0, 0, DENY), op(0x20, 0, 0, 0)]
    ${t.x32 ? "prog.append(op(0x35, len(NRS) + 1, 0, 0x40000000))" : "pass"}
    prog += [op(0x15, len(NRS) - i, 0, nr) for i, nr in enumerate(NRS)]
    prog += [op(0x06, 0, 0, ALLOW), op(0x06, 0, 0, DENY)]
    code = b"".join(prog)
    buf = ctypes.create_string_buffer(code, len(code))
    class Fprog(ctypes.Structure):
        _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.c_void_p)]
    fprog = Fprog(len(prog), ctypes.addressof(buf))
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    if libc.prctl(38, 1, 0, 0, 0) or libc.prctl(22, 2, ctypes.addressof(fprog), 0, 0):
        sys.stderr.write("cx-sandbox: cannot install the network filter: " + os.strerror(ctypes.get_errno()) + "\\n")
        sys.exit(${LAUNCH_FAILED})
os.execvp(argv[0], argv)
`;
})();

/**
 * Check that the filter installs and blocks a socket. Resolves "blocked" or "unavailable".
 * @returns {Promise<"blocked" | "unavailable">}
 */
export function probeNetworkFilter() {
  if (!LAUNCHER) return Promise.resolve("unavailable");
  const probe = "import socket\ntry:\n    socket.socket()\nexcept PermissionError:\n    print('blocked')";
  return new Promise((resolve) => {
    const p = spawn("python3", ["-I", "-c", LAUNCHER, "0", "1", "python3", "-I", "-c", probe], { stdio: ["ignore", "pipe", "ignore"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "production" } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => resolve("unavailable"));
    p.on("close", (/** @type {number | null} */ code) => resolve(code === 0 && out.trim() === "blocked" ? "blocked" : "unavailable"));
  });
}

/**
 * In the image only: make the shared temp dirs unwritable for run uids (root
 * still writes there; each run's own directory is the only place it can read).
 * @returns {Promise<boolean>} whether every existing dir was locked
 */
export async function lockSharedDirs() {
  let ok = true;
  for (const d of SHARED_DIRS) {
    try {
      await chmod(d, 0o711);
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code === "ENOENT") continue;
      // A read-only dir (--read-only) is fine if it is already closed to others, as the image builds it.
      const st = await lstat(d).catch(() => null);
      if (!st || (st.mode & 0o022) !== 0) ok = false;
    }
  }
  return ok;
}

/**
 * Delete whatever a run uid left at the top of the shared temp dirs (it can only create entries there, or inside its own dirs).
 * Runs after the uid's processes are dead, so nothing can race it.
 * @param {number} uid
 */
async function sweepSharedDirs(uid) {
  for (const d of SHARED_DIRS) {
    const names = await readdir(d).catch(() => /** @type {string[]} */ ([]));
    for (const n of names) {
      const p = join(d, n);
      const st = await lstat(p).catch(() => null);
      if (st?.uid === uid) await rm(p, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Total RSS (KB) of a run's processes: those owned by its uid, or in its
 * process group when runs share the server's uid. Null when /proc is unreadable.
 * @param {number | undefined} uid @param {number} pgid
 * @returns {Promise<number | null>}
 */
async function runRssKb(uid, pgid) {
  let pids;
  try {
    pids = (await readdir("/proc")).filter((p) => /^\d+$/.test(p));
  } catch {
    return null;
  }
  let kb = 0;
  for (const pid of pids) {
    const st = await readFile(`/proc/${pid}/status`, "utf8").catch(() => "");
    const mine = uid !== undefined ? Number(/^Uid:\s+(\d+)/m.exec(st)?.[1]) === uid : Number(/^NSpgid:\s+(\d+)/m.exec(st)?.[1]) === pgid;
    if (mine) kb += Number(/^VmRSS:\s+(\d+)/m.exec(st)?.[1] ?? 0);
  }
  return kb;
}

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
 * `uid` (root only) is the run slot's unprivileged user. `allowNetwork` skips
 * the seccomp filter (only for a platform that already denies the container all network).
 * @param {{ language_id: number; source: string; stdin: string; cpuSeconds: number; wallSeconds: number; memoryKb: number; uid?: number; allowNetwork?: boolean }} job
 */
export async function runSubmission(job) {
  const lang = LANGUAGES.find((l) => l.id === job.language_id);
  if (!lang) throw new Error(`unknown language_id ${job.language_id}`);
  if (!LAUNCHER) throw new Error(`no launcher for ${process.arch}`);
  const cpu = Math.ceil(clamp(job.cpuSeconds, 1, 30));
  const wallMs = clamp(job.wallSeconds, 1, 60) * 1000;
  const memMb = Math.floor(clamp(job.memoryKb / 1024, 32, 2048));
  const uid = job.uid;
  const dir = await mkdtemp(join(tmpdir(), "cx-sandbox-"));
  try {
    const file = join(dir, lang.file);
    await writeFile(file, job.source);
    if (uid !== undefined) {
      // Readable by the run's uid (its group), writable by nobody but the server: a run cannot create files.
      await chown(dir, 0, uid);
      await chown(file, 0, uid);
      await chmod(dir, 0o750);
      await chmod(file, 0o640);
    }
    const asKb = lang.id === 71 ? memMb * 1024 : Math.ceil(NODE_AS_BASE_MB + memMb * 1.25) * 1024;
    // The OOM killer, if the container's own limit is ever reached, takes run processes before the server.
    const limits = `ulimit -t ${cpu}; ulimit -f ${MAX_FILE_KB}; ulimit -n ${MAX_FDS}; ulimit -c 0; ${uid !== undefined ? `ulimit -u ${MAX_PROCS}; ` : ""}echo 1000 2>/dev/null >/proc/self/oom_score_adj; `;
    const launch = `exec python3 -I -c "$1" ${asKb} ${job.allowNetwork ? 0 : 1}`;
    const cmd = lang.id === 71 ? `${limits}${launch} python3 -I "$0"` : `${limits}${launch} node --max-old-space-size=${memMb} --stack-size=4000 --disable-wasm-trap-handler "$0"`;
    const child = spawn("bash", ["--noprofile", "--norc", "-c", cmd, file, LAUNCHER], {
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
    /** @type {"wall" | "output" | "memory" | null} */
    let killed = null;
    let running = true;
    const timer = setTimeout(() => {
      killed = "wall";
      void killRun(child, uid);
    }, wallMs);
    // Per-run memory: ulimit -v bounds each process; this bounds all of them together.
    const sampleRss = async () => {
      while (running && killed === null) {
        const kb = child.pid ? await runRssKb(uid, child.pid) : null;
        if (kb === null) return;
        if (running && killed === null && kb > (memMb + RSS_SLACK_MB) * 1024) {
          killed = "memory";
          void killRun(child, uid);
          return;
        }
        await new Promise((r) => setTimeout(r, RSS_SAMPLE_MS));
      }
    };
    const sampling = sampleRss();
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
    running = false;
    // The program is done: nothing it started may outlive it. Then wait (bounded) for its pipes to drain.
    await killRun(child, uid);
    await sampling;
    if (uid !== undefined) await sweepSharedDirs(uid);
    let drain;
    await Promise.race([closed, new Promise((resolve) => (drain = setTimeout(resolve, DRAIN_MS)))]);
    clearTimeout(drain);
    child.stdout.destroy();
    child.stderr.destroy();
    const stdout = Buffer.concat(out).toString("utf8");
    // The launcher could not install the filter: fail closed, as the server's fault, not the program's.
    if (code === LAUNCH_FAILED && stderr.startsWith("cx-sandbox: ")) throw new Error(stderr.trim());
    // ulimit -t ends a CPU-bound process with SIGXCPU (or SIGKILL at the hard limit).
    const tle = killed === "wall" || signal === "SIGXCPU" || (signal === "SIGKILL" && killed === null);
    const status = tle ? STATUS.tle : killed !== null ? STATUS.nzec : code === 0 ? STATUS.accepted : STATUS.nzec;
    const note = killed === "output" ? `output limit ${MAX_OUTPUT_BYTES} bytes exceeded\n` : killed === "memory" ? `memory limit ${memMb} MB exceeded\n` : "";
    return {
      stdout: b64(stdout),
      stderr: b64(note + stderr),
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
 * `uidBase`: first run uid (slot i runs as uidBase + i); give each server on one host its own range, since a run's
 * processes are killed by uid. `allowNetwork`: run without the seccomp filter (see runSubmission).
 * `sharedDirsLocked`: what lockSharedDirs() reported, for /health.
 * @param {{ token?: string; maxConcurrent?: number; maxQueue?: number; uidBase?: number; allowNetwork?: boolean; sharedDirsLocked?: boolean }} [opts]
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
  const uidBase = opts.uidBase ?? RUN_UID_BASE;
  const allowNetwork = opts.allowNetwork ?? false;
  /** "blocked": the filter works; "allowed": skipped on purpose; "unavailable": submissions are refused. */
  const network = allowNetwork ? Promise.resolve("allowed") : probeNetworkFilter();

  return createServer(async (req, res) => {
    /** @param {number} status @param {unknown} body @param {Record<string, string>} [headers] */
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://sandbox");
      if (url.pathname === "/health" && req.method === "GET") {
        const net = await network;
        const isolation = { uid: isolated, network: net, sharedDirs: opts.sharedDirsLocked ? "locked" : "open" };
        return send(net === "unavailable" ? 503 : 200, { ok: net !== "unavailable", active, queued: waiting.length, isolation });
      }
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
        // Fail closed: without the filter, submitted code would have the container's network.
        if ((await network) === "unavailable") return send(503, { error: "network isolation unavailable on this host (see /health)" });
        const slot = await acquire();
        try {
          const result = await runSubmission({
            uid: isolated ? uidBase + slot : undefined,
            allowNetwork,
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
  // The image (CX_SANDBOX_IMAGE=1) listens on every interface, so it never runs open.
  const inImage = process.env.CX_SANDBOX_IMAGE === "1";
  if (inImage && !token) {
    console.error("SANDBOX_TOKEN is required in the container image");
    process.exit(1);
  }
  const uidBase = process.env.SANDBOX_UID_BASE ? Number(process.env.SANDBOX_UID_BASE) : RUN_UID_BASE;
  if (!Number.isInteger(uidBase) || uidBase < 1000) {
    console.error(`SANDBOX_UID_BASE must be an integer >= 1000, got ${process.env.SANDBOX_UID_BASE}`);
    process.exit(1);
  }
  const allowNetwork = process.env.SANDBOX_ALLOW_NETWORK === "1";
  const sharedDirsLocked = inImage && isRoot() ? await lockSharedDirs() : false;
  const server = createSandboxServer({
    token,
    uidBase,
    allowNetwork,
    sharedDirsLocked,
    maxConcurrent: process.env.MAX_CONCURRENT ? Number(process.env.MAX_CONCURRENT) : undefined,
  });
  if (!isRoot()) console.warn("not running as root: submissions share the server's uid and are NOT isolated from each other (development only; use the container image)");
  const net = allowNetwork ? "allowed" : await probeNetworkFilter();
  if (net === "unavailable") console.warn("the seccomp network filter does not work here: submissions are refused (set SANDBOX_ALLOW_NETWORK=1 only if the container itself has no network)");
  if (net === "allowed") console.warn("SANDBOX_ALLOW_NETWORK=1: submitted code has whatever network the container has");
  // Without a token, only this machine may connect: anyone else on the network could run code as you.
  const host = token ? "0.0.0.0" : "127.0.0.1";
  server.listen(port, host, () => console.log(`counterexample sandbox listening on ${host}:${port}${token ? " (token auth on)" : " (no SANDBOX_TOKEN: local only)"}; network for runs: ${net}`));
}
