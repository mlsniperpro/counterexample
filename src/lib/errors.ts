/**
 * Typed errors. Every failure that crosses a module boundary is one of these,
 * so callers (the agent loop, the API route) can decide what is fatal, what is
 * retryable, and what to show the user, without parsing messages.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Missing or malformed configuration (env vars). Fatal; fix the deployment. */
export class ConfigError extends AppError {
  readonly code = "config";
}

/** A network call to an external service failed after retries. */
export class UpstreamError extends AppError {
  readonly code = "upstream";
  constructor(
    readonly service: "token-factory" | "tavily" | "judge0",
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(`${service}: ${message}`, options);
  }
}

/** A model answered, but not in the shape we asked for (bad JSON, schema mismatch, no code block). */
export class ModelOutputError extends AppError {
  readonly code = "model_output";
}

/** Replay mode has no recorded response for this request. */
export class ReplayMissError extends AppError {
  readonly code = "replay_miss";
}

/** A per-attack budget (model calls, sandbox runs, wall clock) ran out. */
export class BudgetExceeded extends AppError {
  readonly code = "budget";
  constructor(
    readonly budget: "modelCalls" | "runs" | "wallClock",
    detail: string,
  ) {
    super(`budget exhausted: ${budget} (${detail})`);
  }
}

/** The caller went away (client disconnected); the attack stops at the next checkpoint. */
export class AttackCancelled extends AppError {
  readonly code = "cancelled";
}

/** The sandbox could not run the program at all (not a runtime error inside user code). */
export class ExecutorError extends AppError {
  readonly code = "executor";
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
