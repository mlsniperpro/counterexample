export type Stage = "understand" | "research" | "oracle" | "attack" | "run" | "shrink" | "explain" | "reattack" | "report";

export const STAGES: Stage[] = ["understand", "research", "oracle", "attack", "run", "shrink", "explain", "reattack", "report"];

export type TraceEvent = {
  seq: number;
  /** ms since the attack started (wall clock). */
  t: number;
  stage: Stage;
  kind: "stage_start" | "stage_end" | "model_call" | "exec" | "research" | "info" | "warn" | "counterexample" | "result";
  msg: string;
  data?: Record<string, unknown>;
};

export class Tracer {
  readonly events: TraceEvent[] = [];
  private seq = 0;
  constructor(
    private readonly t0: number,
    private readonly clock: () => number,
    private readonly sink?: (e: TraceEvent) => void,
  ) {}

  emit(stage: Stage, kind: TraceEvent["kind"], msg: string, data?: Record<string, unknown>): TraceEvent {
    const e: TraceEvent = { seq: this.seq++, t: this.clock() - this.t0, stage, kind, msg, ...(data ? { data } : {}) };
    this.events.push(e);
    this.sink?.(e);
    return e;
  }

  /** The trace as JSON Lines (trace.jsonl). */
  jsonl(): string {
    return this.events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  }
}
