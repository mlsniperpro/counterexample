import { z } from "zod";
import { ConfigError, UpstreamError } from "../errors";
import { DEFAULT_RETRY, postJson, type HttpDeps, type RetryPolicy } from "../net/http";
import { buildProgram, parseLines, reachedReady, runWithRestarts } from "./program";
import type { ChunkResult, Executor, Language, RunRequest, RunResult } from "./types";

export type Judge0Config = {
  baseUrl: string;
  /** Sent as X-Auth-Token (self-hosted), "Authorization: Bearer" (auth "bearer", e.g. a Nebius endpoint) or X-RapidAPI-Key when rapidApiHost is set. */
  token?: string;
  rapidApiHost?: string;
  auth?: "x-auth-token" | "bearer";
  languageIds?: Partial<Record<Language, number>>;
  /** Inputs per submission. A whole chunk shares one CPU-time limit. */
  chunkSize?: number;
  http?: HttpDeps;
  retry?: RetryPolicy;
};

/** Judge0 CE defaults: 71 = Python 3.8.1, 63 = JavaScript (Node.js 12.14.0). */
const DEFAULT_LANGS: Record<Language, number> = { python: 71, javascript: 63 };

const judge0ResponseSchema = z.object({
  stdout: z.string().nullable().optional(),
  stderr: z.string().nullable().optional(),
  compile_output: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  status: z.object({ id: z.number().int(), description: z.string() }),
});

/** wait=true holds the connection until the run finishes, so allow for the wall-time limit plus queueing. */
export const JUDGE0_RETRY: RetryPolicy = { ...DEFAULT_RETRY, timeoutMs: 45_000 };

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string | null | undefined) => (s ? Buffer.from(s, "base64").toString("utf8") : "");

/** Inputs sent per Judge0 submission by default. */
export const JUDGE0_INPUTS_PER_SUBMISSION = 200;

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
    this.cfg = { chunkSize: JUDGE0_INPUTS_PER_SUBMISSION, ...cfg, baseUrl: cfg.baseUrl.replace(/\/+$/, "") };
    let url: URL;
    try {
      url = new URL(this.cfg.baseUrl);
    } catch (e) {
      throw new ConfigError(`JUDGE0_URL is not a valid URL: "${cfg.baseUrl}"`, { cause: e });
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new ConfigError(`JUDGE0_URL must be http(s), got ${url.protocol}`);
    this.label = `Judge0 (${url.host})`;
  }

  static fromEnv(env: Record<string, string | undefined> = process.env): Judge0Executor | null {
    if (!env.JUDGE0_URL) return null;
    const ids: Partial<Record<Language, number>> = {};
    const langId = (name: string, v: string | undefined) => {
      if (v === undefined || v === "") return undefined;
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) throw new ConfigError(`${name} must be a positive integer, got "${v}"`);
      return n;
    };
    const py = langId("JUDGE0_LANG_PYTHON", env.JUDGE0_LANG_PYTHON);
    const js = langId("JUDGE0_LANG_JAVASCRIPT", env.JUDGE0_LANG_JAVASCRIPT);
    if (py) ids.python = py;
    if (js) ids.javascript = js;
    return new Judge0Executor({
      baseUrl: env.JUDGE0_URL,
      token: env.JUDGE0_TOKEN,
      rapidApiHost: env.JUDGE0_RAPIDAPI_HOST,
      auth: authFromEnv(env.JUDGE0_AUTH),
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

  /** Auth headers for this Judge0 endpoint. */
  headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.cfg.token && this.cfg.rapidApiHost) {
      h["X-RapidAPI-Key"] = this.cfg.token;
      h["X-RapidAPI-Host"] = this.cfg.rapidApiHost;
    } else if (this.cfg.token && this.cfg.auth === "bearer") {
      h.authorization = `Bearer ${this.cfg.token}`;
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
    const raw = await postJson(
      "judge0",
      `${this.cfg.baseUrl}/submissions?base64_encoded=true&wait=true`,
      body,
      this.headers(),
      this.cfg.retry ?? JUDGE0_RETRY,
      this.cfg.http,
      req.signal,
    );
    const parsed = judge0ResponseSchema.safeParse(raw);
    if (!parsed.success) throw new UpstreamError("judge0", `unexpected response shape: ${parsed.error.issues[0]?.message ?? "invalid"}`, null, false);
    const j = parsed.data;
    const stdout = unb64(j.stdout);
    const stderr = unb64(j.stderr) || unb64(j.compile_output) || unb64(j.message);
    const lines = parseLines(stdout);
    const status = j.status.id;
    // 3 Accepted, 5 Time Limit Exceeded, 6 Compilation Error, 7-12 Runtime Error, 13 Internal, 14 Exec Format
    if (status === 6 || (!reachedReady(stdout) && status !== 5)) {
      return { lines: [], end: "compile", message: stderr.slice(-500) || j.status.description };
    }
    if (status === 3) return { lines, end: "ok", message: "" };
    if (status === 5) return { lines, end: "timeout", message: "time limit exceeded" };
    if (status >= 13) throw new UpstreamError("judge0", `internal error: ${j.status.description} ${stderr.slice(0, 300)}`, null, false);
    return { lines, end: "crash", message: `${j.status.description}: ${stderr.slice(-300)}` };
  }
}

function authFromEnv(v: string | undefined): Judge0Config["auth"] {
  if (v === undefined || v === "" || v === "x-auth-token") return "x-auth-token";
  if (v === "bearer") return "bearer";
  throw new ConfigError(`JUDGE0_AUTH must be "x-auth-token" or "bearer", got "${v}"`);
}
