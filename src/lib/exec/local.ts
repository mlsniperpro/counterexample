import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgram, parseLines, reachedReady, runWithRestarts } from "./program";
import type { ChunkResult, Executor, RunRequest, RunResult } from "./types";

const STARTUP_GRACE_MS = 3000;

/**
 * DEV ONLY. Runs Python or JavaScript as a local subprocess with a per-input
 * time limit and a memory limit. It is NOT a security sandbox: no network or
 * filesystem isolation. Use Judge0Executor for anything user-facing.
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
      const { outcomes, processes } = await runWithRestarts(req.inputs, (chunk) =>
        this.runChunk(file, req, chunk),
      );
      return { outcomes, processes, wallMs: Date.now() - t0 };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private runChunk(file: string, req: RunRequest, chunk: unknown[][]): Promise<ChunkResult> {
    const mb = Math.max(32, Math.floor(req.memoryLimitMb));
    const [cmd, args]: [string, string[]] =
      req.language === "python"
        ? ["bash", ["-c", `ulimit -v ${mb * 1024}; exec python3 -I "$0"`, file]]
        : ["node", [`--max-old-space-size=${mb}`, `--stack-size=4000`, file]];
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "production" },
      });
      let stdout = "";
      let stderr = "";
      let lines = 0;
      let timedOut = false;
      let timer: NodeJS.Timeout | undefined;
      const arm = (ms: number) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, ms);
      };
      arm(STARTUP_GRACE_MS + req.timeLimitMs);
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
        const n = (stdout.match(/\x1eCX/g) ?? []).length;
        if (n !== lines || (lines === 0 && reachedReady(stdout))) {
          lines = n;
          arm(req.timeLimitMs);
        }
      });
      child.stderr.on("data", (d: Buffer) => {
        if (stderr.length < 20000) stderr += d.toString();
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ inputs: chunk }));
      child.on("close", (code: number | null) => {
        if (timer) clearTimeout(timer);
        const parsed = parseLines(stdout);
        const tail = stderr.trim().split("\n").slice(-3).join("\n");
        if (!reachedReady(stdout) && !timedOut) {
          resolve({ lines: [], end: "compile", message: tail || `exit ${code}` });
          return;
        }
        const end = timedOut ? "timeout" : code === 0 ? "ok" : "crash";
        const message = timedOut
          ? `time limit ${req.timeLimitMs}ms exceeded`
          : /MemoryError|heap out of memory|Cannot allocate/i.test(stderr)
            ? "memory limit exceeded"
            : tail || `exit ${code}`;
        resolve({ lines: parsed, end, message });
      });
    });
  }
}
