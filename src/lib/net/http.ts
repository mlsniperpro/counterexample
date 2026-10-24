import { UpstreamError } from "../errors";

export type Service = UpstreamError["service"];

export type RetryPolicy = {
  /** Attempts in total (first try included). */
  attempts: number;
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Base delay for exponential backoff with full jitter. */
  baseDelayMs: number;
  maxDelayMs: number;
};

export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, timeoutMs: 60_000, baseDelayMs: 500, maxDelayMs: 8_000 };

export type HttpDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** Delay before retry n (0-based): Retry-After when the server sent one, else full-jitter exponential backoff. */
export function backoffMs(n: number, policy: RetryPolicy, retryAfter: string | null, random: () => number): number {
  if (retryAfter) {
    const s = Number(retryAfter);
    if (Number.isFinite(s) && s >= 0) return Math.min(policy.maxDelayMs, s * 1000);
  }
  const cap = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** n);
  return Math.floor(random() * cap);
}

/**
 * POST JSON with a per-attempt timeout and bounded retries on network errors,
 * timeouts and retryable statuses (408, 425, 429, 5xx). Other statuses fail
 * at once. Every call here is safe to repeat: chat completions and searches
 * have no side effects, and a duplicate Judge0 submission only costs a run.
 * The same Idempotency-Key is sent on every attempt for servers that honour it.
 * `signal` (the caller's cancellation or deadline) aborts the in-flight
 * request and any backoff wait; it is rethrown as is, never retried.
 */
export async function postJson(
  service: Service,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  policy: RetryPolicy = DEFAULT_RETRY,
  deps: HttpDeps = {},
  signal?: AbortSignal,
): Promise<unknown> {
  return requestJson(service, "POST", url, body, headers, policy, deps, signal);
}

/** GET JSON with the same timeout, retry and abort behaviour as postJson. */
export async function getJson(
  service: Service,
  url: string,
  headers: Record<string, string>,
  policy: RetryPolicy = DEFAULT_RETRY,
  deps: HttpDeps = {},
  signal?: AbortSignal,
): Promise<unknown> {
  return requestJson(service, "GET", url, undefined, headers, policy, deps, signal);
}

async function requestJson(
  service: Service,
  method: "GET" | "POST",
  url: string,
  body: unknown,
  headers: Record<string, string>,
  policy: RetryPolicy,
  deps: HttpDeps,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const idempotencyKey = crypto.randomUUID();
  let last: UpstreamError | undefined;
  let retryAfter: string | null = null;
  for (let attempt = 0; attempt < policy.attempts; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt - 1, policy, retryAfter, random), signal);
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(policy.timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers: method === "POST" ? { "content-type": "application/json", "idempotency-key": idempotencyKey, ...headers } : headers,
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      last = new UpstreamError(service, timedOut ? `timed out after ${policy.timeoutMs}ms` : `network error: ${(e as Error).message}`, null, true, { cause: e });
      retryAfter = null;
      continue;
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch (e) {
        throw new UpstreamError(service, `HTTP ${res.status} with a body that is not JSON`, res.status, false, { cause: e });
      }
    }
    const text = (await res.text().catch(() => "")).slice(0, 300);
    const retryable = RETRYABLE_STATUS.has(res.status);
    last = new UpstreamError(service, `HTTP ${res.status}: ${text}`, res.status, retryable);
    retryAfter = res.headers.get("retry-after");
    if (!retryable) throw last;
  }
  throw last ?? new UpstreamError(service, "no attempts made", null, false);
}
