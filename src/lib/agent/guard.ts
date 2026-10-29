import { z } from "zod";
import { ConfigError } from "../errors";
import { MAX_TOKENS_FAST, MAX_TOKENS_REASONING } from "../models/config";
import { priceFor, type Price } from "../models/pricing";

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
  /** Replay attacks spend no model money, only sandbox time (still bounded by MAX_CONCURRENT_ATTACKS), so judges can click through freely. */
  REPLAY_RATE_LIMIT_PER_HOUR: intFromEnv(120),
  ATTACKS_PER_IP_PER_DAY: intFromEnv(30),
  DAILY_SPEND_CAP_USD: z.coerce.number().min(0).default(2),
  // Two: an attack at the DSL caps can hold about 1 GB of generated inputs until it ends (README "Load and limits").
  MAX_CONCURRENT_ATTACKS: z.coerce.number().int().min(1).default(2),
  /** Charged against the daily cap for each call to a model with no known price, so unpriced models cannot bypass it. */
  UNPRICED_CALL_USD: z.coerce.number().min(0).default(0.05),
});
type GuardConfig = z.infer<typeof guardEnvSchema>;

export function guardConfig(env: Env = process.env): GuardConfig {
  const pick = (k: keyof GuardConfig) => (env[k] === "" ? undefined : env[k]);
  const r = guardEnvSchema.safeParse({
    RATE_LIMIT_PER_HOUR: pick("RATE_LIMIT_PER_HOUR"),
    REPLAY_RATE_LIMIT_PER_HOUR: pick("REPLAY_RATE_LIMIT_PER_HOUR"),
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

/** `recent`/`today` count live attacks; `replay` counts replay attacks in the last hour. */
type Usage = { recent: number[]; replay: number[]; day: string; today: number };

/**
 * A concurrency slot expires after this long even if done() never runs (the
 * platform killed the invocation at maxDuration), so slots cannot leak.
 */
export const LEASE_MS = 120_000;

/**
 * Worst-case tokens of one model call, for the spend reservation: completions
 * are capped at NebiusProvider's default max_tokens, MAX_TOKENS_REASONING for
 * the reasoning model and MAX_TOKENS_FAST for the fast one, so every call is
 * reserved at the larger of the two; prompts are bounded by the
 * request caps (28,000 characters of statement and code) plus the agent's own
 * prompts and research text, taken as at most 32,000 tokens.
 */
export const RESERVE_PROMPT_TOKENS = 32_000;
export const RESERVE_COMPLETION_TOKENS = Math.max(MAX_TOKENS_REASONING, MAX_TOKENS_FAST);

/**
 * The most one attack can spend: every allowed model call at worst-case
 * tokens on the dearest of the models it may use (an unpriced model at
 * UNPRICED_CALL_USD). Reserved at admit so concurrent attacks cannot overshoot the cap.
 */
export function worstCaseAttackUsd(maxModelCalls: number, models: string[], prices: Record<string, Price>, unpricedCallUsd: number): number {
  const perCall = Math.max(
    0,
    ...models.map((m) => {
      const p = priceFor(m, prices);
      return p ? (RESERVE_PROMPT_TOKENS * p.in + RESERVE_COMPLETION_TOKENS * p.out) / 1e6 : unpricedCallUsd;
    }),
  );
  return maxModelCalls * perCall;
}

type Lease = { start: number; reservedUsd: number; day: string };

type GuardDecision = { ok: true; ticket: number } | { ok: false; status: 429 | 503; reason: string; retryAfterS: number };

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

export class Guard {
  private readonly usage = new Map<string, Usage>();
  private spend = { day: "", usd: 0 };
  /** Active attacks: ticket to start time and the spend reserved for it (already counted in spend). */
  private readonly leases = new Map<number, Lease>();
  private nextTicket = 1;

  constructor(readonly config: GuardConfig) {}

  /**
   * Admit one attack from this IP now, or say why not. On success the caller must call done().
   * A live attack reserves `reserveUsd` (its worst case) against the daily cap until done() settles it.
   */
  admit(ip: string, now: number, live: boolean, reserveUsd = 0): GuardDecision {
    const u = this.touch(ip, now);
    const recent = live ? u.recent : u.replay;
    if (recent.length >= (live ? this.config.RATE_LIMIT_PER_HOUR : this.config.REPLAY_RATE_LIMIT_PER_HOUR)) {
      const oldest = recent[0] ?? now;
      return { ok: false, status: 429, reason: "Hourly limit reached for your address.", retryAfterS: Math.ceil((HOUR - (now - oldest)) / 1000) };
    }
    if (live && u.today >= this.config.ATTACKS_PER_IP_PER_DAY) {
      return { ok: false, status: 429, reason: "Daily limit reached for your address.", retryAfterS: secondsToMidnightUtc(now) };
    }
    if (live && !this.spendAllowed(now, reserveUsd)) {
      return { ok: false, status: 503, reason: "Today's model budget for this demo is spent.", retryAfterS: secondsToMidnightUtc(now) };
    }
    // An expired lease keeps its reservation: the killed attack may have spent it.
    for (const [t, l] of this.leases) if (now - l.start > LEASE_MS) this.leases.delete(t);
    if (this.leases.size >= this.config.MAX_CONCURRENT_ATTACKS) {
      return { ok: false, status: 503, reason: "The server is busy with other attacks.", retryAfterS: 10 };
    }
    recent.push(now);
    if (live) u.today++;
    const ticket = this.nextTicket++;
    const reservedUsd = live ? reserveUsd : 0;
    this.spend.usd += reservedUsd;
    this.leases.set(ticket, { start: now, reservedUsd, day: this.spend.day });
    return { ok: true, ticket };
  }

  /**
   * Release the slot and settle the spend: the reservation is replaced by what the attack spent (unpriced
   * calls at UNPRICED_CALL_USD each). A reservation from an earlier UTC day is not refunded from today's total.
   */
  done(ticket: number, spent: { costUsd: number; unpricedCalls: number }, now: number): void {
    const lease = this.leases.get(ticket);
    this.leases.delete(ticket);
    this.rollSpend(now);
    const refund = lease && lease.day === this.spend.day ? lease.reservedUsd : 0;
    this.spend.usd = Math.max(0, this.spend.usd - refund) + spent.costUsd + spent.unpricedCalls * this.config.UNPRICED_CALL_USD;
  }

  get activeAttacks(): number {
    return this.leases.size;
  }

  /** Whether today's spend (reservations included) is under the cap, with room for `reserveUsd` more. */
  spendAllowed(now: number, reserveUsd = 0): boolean {
    this.rollSpend(now);
    return this.spend.usd < this.config.DAILY_SPEND_CAP_USD && this.spend.usd + reserveUsd <= this.config.DAILY_SPEND_CAP_USD;
  }

  /** Today's spend, reservations of running attacks included. */
  spentUsd(now: number): number {
    this.rollSpend(now);
    return this.spend.usd;
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
    else u = { recent: [], replay: [], day: dayOf(now), today: 0 };
    u.recent = u.recent.filter((t) => now - t < HOUR);
    u.replay = u.replay.filter((t) => now - t < HOUR);
    if (u.day !== dayOf(now)) u = { recent: u.recent, replay: u.replay, day: dayOf(now), today: 0 };
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
