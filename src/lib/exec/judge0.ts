import { buildProgram, parseLines, reachedReady, runWithRestarts } from "./program";
import type { ChunkResult, Executor, Language, RunRequest, RunResult } from "./types";

export type Judge0Config = {
  baseUrl: string;
  /** Sent as X-Auth-Token (self-hosted) or X-RapidAPI-Key when rapidApiHost is set. */
  token?: string;
  rapidApiHost?: string;
  languageIds?: Partial<Record<Language, number>>;
  /** Inputs per submission. A whole chunk shares one CPU-time limit. */
  chunkSize?: number;
  fetchImpl?: typeof fetch;
};

/** Judge0 CE defaults: 71 = Python 3.8.1, 63 = JavaScript (Node.js 12.14.0). */
const DEFAULT_LANGS: Record<Language, number> = { python: 71, javascript: 63 };

type Judge0Response = {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  status: { id: number; description: string };
};

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string | null) => (s ? Buffer.from(s, "base64").toString("utf8") : "");

/**
 * Runs code on any Judge0-compatible API (self-hosted Judge0 CE, or RapidAPI).
 * Judge0 has no per-input timeout, so each chunk gets chunk*limit of CPU time;
 * when a chunk is killed, the driver blames the next unreported input and
 * resubmits the remainder.
 */
export class Judge0Executor implements Executor {
  readonly name = "judge0";
  readonly label: string;
  private readonly cfg: Required<Pick<Judge0Config, "chunkSize">> & Judge0Config;

  constructor(cfg: Judge0Config) {
    this.cfg = { chunkSize: 200, ...cfg, baseUrl: cfg.baseUrl.replace(/\/+$/, "") };
    this.label = `Judge0 (${new URL(this.cfg.baseUrl).host})`;
  }

  static fromEnv(env: Record<string, string | undefined> = process.env): Judge0Executor | null {
    if (!env.JUDGE0_URL) return null;
    const ids: Partial<Record<Language, number>> = {};
    if (env.JUDGE0_LANG_PYTHON) ids.python = Number(env.JUDGE0_LANG_PYTHON);
    if (env.JUDGE0_LANG_JAVASCRIPT) ids.javascript = Number(env.JUDGE0_LANG_JAVASCRIPT);
    return new Judge0Executor({
      baseUrl: env.JUDGE0_URL,
      token: env.JUDGE0_TOKEN,
      rapidApiHost: env.JUDGE0_RAPIDAPI_HOST,
      languageIds: ids,
    });
  }

  async run(req: RunRequest): Promise<RunResult> {
    const t0 = Date.now();
    const source = buildProgram(req.language, req.code, req.entry);
    const { outcomes, processes } = await runWithRestarts(
      req.inputs,
      (chunk) => this.submit(source, req, chunk),
      this.cfg.chunkSize,
    );
    return { outcomes, processes, wallMs: Date.now() - t0 };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.cfg.token && this.cfg.rapidApiHost) {
      h["X-RapidAPI-Key"] = this.cfg.token;
      h["X-RapidAPI-Host"] = this.cfg.rapidApiHost;
    } else if (this.cfg.token) {
      h["X-Auth-Token"] = this.cfg.token;
    }
    return h;
  }

  private async submit(source: string, req: RunRequest, chunk: unknown[][]): Promise<ChunkResult> {
    const languageId = this.cfg.languageIds?.[req.language] ?? DEFAULT_LANGS[req.language];
    const cpuSeconds = Math.min(15, Math.max(1, (req.timeLimitMs * chunk.length) / 1000 + 0.5));
    const body = {
      source_code: b64(source),
      language_id: languageId,
      stdin: b64(JSON.stringify({ inputs: chunk })),
      cpu_time_limit: cpuSeconds,
      wall_time_limit: Math.min(20, cpuSeconds * 2),
      memory_limit: Math.max(32, req.memoryLimitMb) * 1024,
    };
    const doFetch = this.cfg.fetchImpl ?? fetch;
    const res = await doFetch(`${this.cfg.baseUrl}/submissions?base64_encoded=true&wait=true`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Judge0 HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const j = (await res.json()) as Judge0Response;
    const stdout = unb64(j.stdout);
    const stderr = unb64(j.stderr) || unb64(j.compile_output) || unb64(j.message);
    const lines = parseLines(stdout);
    const status = j.status?.id ?? 13;
    // 3 Accepted, 5 Time Limit Exceeded, 6 Compilation Error, 7-12 Runtime Error, 13 Internal, 14 Exec Format
    if (status === 6 || (!reachedReady(stdout) && status !== 5)) {
      return { lines: [], end: "compile", message: stderr.slice(-500) || j.status.description };
    }
    if (status === 3) return { lines, end: "ok", message: "" };
    if (status === 5) return { lines, end: "timeout", message: "time limit exceeded" };
    if (status >= 13) throw new Error(`Judge0 internal error: ${j.status.description} ${stderr.slice(0, 300)}`);
    return { lines, end: "crash", message: `${j.status.description}: ${stderr.slice(-300)}` };
  }
}
