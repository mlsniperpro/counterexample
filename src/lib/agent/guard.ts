/**
 * Public-deployment guards: per-IP rate limit and a daily model-spend cap.
 * In-memory, so per server instance; good enough for a hackathon preview.
 */
type Env = Record<string, string | undefined>;

const hits = new Map<string, number[]>();
let spend = { day: "", usd: 0 };

const today = (now: number) => new Date(now).toISOString().slice(0, 10);

export function checkRateLimit(ip: string, now = Date.now(), env: Env = process.env): { ok: boolean; retryAfterS: number } {
  const limit = Number(env.RATE_LIMIT_PER_HOUR ?? 10);
  const windowMs = 3_600_000;
  const xs = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (xs.length >= limit) {
    hits.set(ip, xs);
    return { ok: false, retryAfterS: Math.ceil((windowMs - (now - xs[0])) / 1000) };
  }
  xs.push(now);
  hits.set(ip, xs);
  return { ok: true, retryAfterS: 0 };
}

export function spendAllowed(now = Date.now(), env: Env = process.env): boolean {
  const cap = Number(env.DAILY_SPEND_CAP_USD ?? 2);
  if (spend.day !== today(now)) spend = { day: today(now), usd: 0 };
  return spend.usd < cap;
}

export function recordSpend(usd: number, now = Date.now()): void {
  if (spend.day !== today(now)) spend = { day: today(now), usd: 0 };
  spend.usd += usd;
}

export function resetGuards(): void {
  hits.clear();
  spend = { day: "", usd: 0 };
}
