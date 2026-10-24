export type Language = "python" | "javascript";

export type RunRequest = {
  language: Language;
  code: string;
  /** Name of the function to call with each argument list. */
  entry: string;
  inputs: unknown[][];
  /** Per-input time limit. */
  timeLimitMs: number;
  memoryLimitMb: number;
};

export type RunOutcome =
  | { ok: true; out: unknown; ms: number }
  | { ok: false; error: "timeout" | "runtime" | "compile" | "internal"; message: string };

export type RunResult = {
  outcomes: RunOutcome[];
  wallMs: number;
  /** How many sandbox processes / submissions this batch took. */
  processes: number;
};

export interface Executor {
  readonly name: string;
  /** Human-readable label shown in the UI and trace. */
  readonly label: string;
  run(req: RunRequest): Promise<RunResult>;
}

/** One sandbox invocation over a contiguous chunk of inputs. */
export type ChunkResult = {
  /** Parsed result lines, in order, starting at the chunk's first input. */
  lines: RunOutcome[];
  /** How the process ended. "timeout" and "crash" blame the input after the last line. */
  end: "ok" | "timeout" | "crash" | "compile";
  message: string;
};
