import { CLIENT_TIMEOUT_MS, TIMED_OUT, type RunOutcome } from "./run-state";
import { readAttackStream, type StreamMsg } from "./stream";

export type AttackRunDeps = {
  /** The run's controller: aborted on the client deadline, and always once the run ends. */
  controller: AbortController;
  /** The request body (see buildAttackBody). */
  body: unknown;
  onMsg: (m: StreamMsg) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * POST /api/attack and read its stream to the end, turning however it ended
 * into a RunOutcome for runReducer. Never throws. Whatever ends the run (the
 * report, an unreadable line, a cut stream, the deadline), the controller is
 * aborted in `finally`, so the request is torn down and the server frees its
 * attack slot; readAttackStream cancels the reader in its own `finally`.
 */
export async function attackRun({ controller: ac, body, onMsg, fetchImpl = fetch, timeoutMs = CLIENT_TIMEOUT_MS }: AttackRunDeps): Promise<RunOutcome> {
  const timer = setTimeout(() => ac.abort(TIMED_OUT), timeoutMs);
  try {
    const res = await fetchImpl("/api/attack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok || !res.body) {
      const j: { error?: string } = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(j.error ?? res.statusText);
    }
    return await readAttackStream(res.body, onMsg);
  } catch (e) {
    return { thrown: e, abortReason: ac.signal.aborted ? ac.signal.reason : undefined };
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}
