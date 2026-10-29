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

/** Why the server refused the request, in words: its own `error` text if it sent some, else the HTTP status (statusText is empty over HTTP/2). */
async function refusal(res: Response): Promise<string> {
  const j: unknown = await res.json().catch(() => null);
  const error = typeof j === "object" && j !== null ? (j as { error?: unknown }).error : undefined;
  return typeof error === "string" && error.trim() ? error : `The server returned HTTP ${res.status}.`;
}

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
    if (!res.ok) throw new Error(await refusal(res));
    if (!res.body) throw new Error("The server sent an empty response.");
    return await readAttackStream(res.body, onMsg);
  } catch (e) {
    return { thrown: e, abortReason: ac.signal.aborted ? ac.signal.reason : undefined };
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}
