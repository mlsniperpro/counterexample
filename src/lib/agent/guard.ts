import { z } from "zod";
import { ConfigError } from "../errors";

/**
 * Public-deployment guards: per-IP hourly and daily attack limits, a global
 * daily model-spend cap, and a cap on concurrent attacks per instance.
 *
 * State lives in this server instance's memory. That keeps the handler free
 * of external dependencies, but limits are per instance: with N serverless
 * instances the effective limits are up to N times higher. A shared store
 * (e.g. Redis) is the next step past a hackathon preview; see the PR notes.
 */
type Env = Record<string, string | undefined>;

const intFromEnv = (fallback: number) => z.coerce.number().int().min(0).default(fallback);
const guardEnvSchema = z.object({
  RATE_LIMIT_PER_HOUR: intFromEnv(10),
  ATTACKS_PER_IP_PER_DAY: intFromEnv(30),
  DAILY_SPEND_CAP_USD: z.coerce.number().min(0).default(2),
  MAX_CONCURRENT_ATTACKS: z.coerce.number().int().min(1).default(4),
  /** Charged against the daily cap for each call to a model with no known price, so unpriced models cannot bypass it. */
  UNPRICED_CALL_USD: z.coerce.number().min(0).default(0.05),
});
export type GuardConfig = z.infer<typeof guardEnvSchema>;

export function guardConfig(env: Env = process.env): GuardConfig {
  const pick = (k: keyof GuardConfig) => (env[k] === "" ? undefined : env[k]);
  const r = guardEnvSchema.safeParse({
    RATE_LIMIT_PER_HOUR: pick("RATE_LIMIT_PER_HOUR"),
    ATTACKS_PER_IP_PER_DAY: pick("ATTACKS_PER_IP_PER_DAY"),
    DAILY_SPEND_CAP_USD: pick("DAILY_SPEND_CAP_USD"),
    MAX_CONCURRENT_ATTACKS: pick("MAX_CONCURRENT_ATTACKS"),
    UNPRICED_CALL_USD: pick("UNPRICED_CALL_USD"),
  });
  if (!r.success) throw new ConfigError(`guard settings: ${z.prettifyError(r.error)}`);
  return r.data;
}

/** Tracked IPs are bounded; the oldest entries are evicted first (Map keeps insertion order). */
export const MAX_TRACKED_IPS = 10_000;
const HOUR = 3_600_000;

type Usage = { recent: number[]; day: string; today: number };

/**
 * A concurrency slot expires after this long even if done() never runs (the
 * platform killed the invocation at maxDuration), so slots cannot leak.
 */
export const LEASE_MS = 120_000;

export type GuardDecision = { ok: true; ticket: number } | { ok: false; status: 429 | 503; reason: string; retryAfterS: number };

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

export class Guard {
  private readonly usage = new Map<string, Usage>();
  private spend = { day: "", usd: 0 };
  /** Active attacks: ticket to start time. */
  private readonly leases = new Map<number, number>();
  private nextTicket = 1;

  constructor(readonly config: GuardConfig) {}

  /** Admit one attack from this IP now, or say why not. On success the caller must call done(). */
  admit(ip: string, now: number, live: boolean): GuardDecision {
    const u = this.touch(ip, now);
    if (u.recent.length >= this.config.RATE_LIMIT_PER_HOUR) {
      const oldest = u.recent[0] ?? now;
      return { ok: false, status: 429, reason: "Hourly limit reached for your address.", retryAfterS: Math.ceil((HOUR - (now - oldest)) / 1000) };
    }
    if (u.today >= this.config.ATTACKS_PER_IP_PER_DAY) {
      return { ok: false, status: 429, reason: "Daily limit reached for your address.", retryAfterS: secondsToMidnightUtc(now) };
    }
    if (live && !this.spendAllowed(now)) {
      return { ok: false, status: 503, reason: "Today's model budget for this demo is spent.", retryAfterS: secondsToMidnightUtc(now) };
    }
    for (const [t, start] of this.leases) if (now - start > LEASE_MS) this.leases.delete(t);
    if (this.leases.size >= this.config.MAX_CONCURRENT_ATTACKS) {
      return { ok: false, status: 503, reason: "The server is busy with other attacks.", retryAfterS: 10 };
    }
    u.recent.push(now);
    u.today++;
    const ticket = this.nextTicket++;
    this.leases.set(ticket, now);
    return { ok: true, ticket };
  }

  /** Release the slot and charge what the attack spent (unpriced calls at UNPRICED_CALL_USD each). Idempotent per ticket for the slot. */
  done(ticket: number, spent: { costUsd: number; unpricedCalls: number }, now: number): void {
    this.leases.delete(ticket);
    this.rollSpend(now);
    this.spend.usd += spent.costUsd + spent.unpricedCalls * this.config.UNPRICED_CALL_USD;
  }

  get activeAttacks(): number {
    return this.leases.size;
  }

  spendAllowed(now: number): boolean {
    this.rollSpend(now);
    return this.spend.usd < this.config.DAILY_SPEND_CAP_USD;
  }

  get trackedIps(): number {
    return this.usage.size;
  }

  private rollSpend(now: number): void {
    if (this.spend.day !== dayOf(now)) this.spend = { day: dayOf(now), usd: 0 };
  }

  private touch(ip: string, now: number): Usage {
    let u = this.usage.get(ip);
    if (u) this.usage.delete(ip); // re-insert below to mark as most recent
    else u = { recent: [], day: dayOf(now), today: 0 };
    u.recent = u.recent.filter((t) => now - t < HOUR);
    if (u.day !== dayOf(now)) u = { recent: u.recent, day: dayOf(now), today: 0 };
    this.usage.set(ip, u);
    while (this.usage.size > MAX_TRACKED_IPS) {
      const oldest = this.usage.keys().next().value;
      if (oldest === undefined) break;
      this.usage.delete(oldest);
    }
    return u;
  }
}

function secondsToMidnightUtc(now: number): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.ceil((next.getTime() - now) / 1000);
}
