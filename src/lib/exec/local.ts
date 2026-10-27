import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutorError } from "../errors";
import { Semaphore } from "../limit";
import { buildProgram, parseLines, reachedReady, runWithRestarts } from "./program";
import type { ChunkResult, Executor, RunRequest, RunResult } from "./types";

const STARTUP_GRACE_MS = 3000;
/** Output beyond this is not read: the process is killed and the chunk counts as a crash. */
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 20_000;
const RECORD = "\x1eCX";
/** After the program exits and its process group is killed, how long to wait for its pipes to close. */
const DRAIN_MS = 1000;

/** One pool for the whole process, so parallel attacks cannot fork without bound. */
const processes = new Semaphore(Math.max(2, availableParallelism()));

/**
 * DEV ONLY. Runs Python or JavaScript as a local subprocess with a per-input
 * time limit, a memory limit and an output cap. It is NOT a security sandbox:
 * no network or filesystem isolation. Use Judge0Executor for anything
 * user-facing (production refuses this executor, see agent/setup.ts).
 */
export class LocalExecutor implements Executor {
  readonly name = "local";
  readonly label = "Local subprocess (dev only, not sandboxed)";

  async run(req: RunRequest): Promise<RunResult> {
    const t0 = Date.now();
    const dir = await mkdtemp(join(tmpdir(), "cx-"));
    try {
      const file = join(dir, req.language === "python" ? "main.py" : "main.js");
      await writeFile(file, buildProgram(req.language, req.code, req.entry));
      const { outcomes, processes: n } = await runWithRestarts(req.inputs, (chunk) =>
        processes.run(() => {
          req.signal?.throwIfAborted();
          return runChunk(file, req, chunk);
        }),
      );
      return { outcomes, processes: n, wallMs: Date.now() - t0 };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function runChunk(file: string, req: RunRequest, chunk: unknown[][]): Promise<ChunkResult> {
  const mb = Math.max(32, Math.floor(req.memoryLimitMb));
  const [cmd, args]: [string, string[]] =
    req.language === "python"
      ? ["bash", ["--noprofile", "--norc", "-c", `ulimit -v ${mb * 1024}; exec python3 -I "$0"`, file]]
      : ["node", [`--max-old-space-size=${mb}`, `--stack-size=4000`, file]];
  return new Promise((resolve, reject) => {
    // Its own process group, so a forked child dies with it instead of holding the pipes open.
    const child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "production" },
      detached: true,
    });
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // The group is already gone.
      }
    };
    const out: Buffer[] = [];
    let outBytes = 0;
    let stderr = "";
    let records = 0;
    let ready = false;
    let tail = ""; // last few bytes of the previous chunk, so a marker split across chunks is still seen
    let killedFor: "timeout" | "output" | null = null;
    let timer: NodeJS.Timeout | undefined;
    const arm = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        killedFor = "timeout";
        killGroup();
      }, ms);
    };
    arm(STARTUP_GRACE_MS + req.timeLimitMs);
    const onAbort = killGroup;
    req.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d: Buffer) => {
      if (killedFor) return;
      outBytes += d.length;
      if (outBytes > MAX_STDOUT_BYTES) {
        killedFor = "output";
        killGroup();
        return;
      }
      out.push(d);
      // Count new records in this chunk only (linear in total output).
      const text = tail + d.toString("latin1");
      const before = records;
      records += text.split(RECORD).length - 1;
      if (!ready && text.includes("\x1eCR")) ready = true;
      tail = text.slice(-(RECORD.length - 1));
      if (records !== before || (before === 0 && ready)) arm(req.timeLimitMs);
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += d.toString();
    });
    child.stdin.on("error", () => {
      // EPIPE when the child exits early (compile error); the close handler reports it.
    });
    child.on("error", (e) => {
      // Spawn failed (e.g. python3 or node missing): not the user's fault, so not a runtime error.
      if (timer) clearTimeout(timer);
      reject(new ExecutorError(`could not start ${cmd}: ${e.message}`, { cause: e }));
    });
    child.stdin.end(JSON.stringify({ inputs: chunk }));
    // Finish on exit: kill what the program left behind, then wait (bounded) for its pipes to drain.
    child.on("exit", (code: number | null) => {
      killGroup();
      const drain = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(code);
      }, DRAIN_MS);
      child.on("close", () => {
        clearTimeout(drain);
        finish(code);
      });
    });
    let finished = false;
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      req.signal?.removeEventListener("abort", onAbort);
      if (req.signal?.aborted) {
        reject(req.signal.reason);
        return;
      }
      const stdout = Buffer.concat(out).toString("utf8");
      const lastLines = errorSummary(stderr);
      if (!reachedReady(stdout) && !killedFor) {
        resolve({ lines: [], end: "compile", message: lastLines || `exit ${code}` });
        return;
      }
      const lines = parseLines(stdout, chunk.length);
      if (killedFor === "timeout") resolve({ lines, end: "timeout", message: `time limit ${req.timeLimitMs}ms exceeded` });
      else if (killedFor === "output") resolve({ lines, end: "crash", message: `output limit ${MAX_STDOUT_BYTES} bytes exceeded` });
      else if (code === 0) resolve({ lines, end: "ok", message: "" });
      else {
        const memory = /MemoryError|heap out of memory|Cannot allocate/i.test(stderr);
        resolve({ lines, end: "crash", message: memory ? "memory limit exceeded" : lastLines || `exit ${code}` });
      }
    };
  });
}

/** The most useful line of an error dump: the last "SomethingError: ..." line, else the last three lines. */
export function errorSummary(stderr: string): string {
  const lines = stderr.trim().split("\n");
  const named = lines.filter((l) => /^\s*[\w.]*(Error|Exception)\b.*:/.test(l)).at(-1);
  return (named ?? lines.slice(-3).join("\n")).trim();
}
