import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runs } from "../helpers";
import { Guard, guardConfig, LEASE_MS, MAX_TRACKED_IPS, RESERVE_COMPLETION_TOKENS, RESERVE_PROMPT_TOKENS, worstCaseAttackUsd } from "@/lib/agent/guard";
import { ConfigError } from "@/lib/errors";
import { Semaphore } from "@/lib/limit";

const DAY = Date.UTC(2026, 9, 24, 12);
const cfg = (over: Partial<ReturnType<typeof guardConfig>> = {}) => ({ ...guardConfig({}), ...over });

describe("guard config", () => {
  it("has defaults and validates env", () => {
    expect(guardConfig({})).toEqual({ RATE_LIMIT_PER_HOUR: 10, REPLAY_RATE_LIMIT_PER_HOUR: 120, ATTACKS_PER_IP_PER_DAY: 30, DAILY_SPEND_CAP_USD: 2, MAX_CONCURRENT_ATTACKS: 4, UNPRICED_CALL_USD: 0.05 });
    expect(guardConfig({ RATE_LIMIT_PER_HOUR: "3", DAILY_SPEND_CAP_USD: "0.5", MAX_CONCURRENT_ATTACKS: "" }).RATE_LIMIT_PER_HOUR).toBe(3);
    expect(() => guardConfig({ RATE_LIMIT_PER_HOUR: "lots" })).toThrow(ConfigError);
    expect(() => guardConfig({ MAX_CONCURRENT_ATTACKS: "0" })).toThrow(ConfigError);
    expect(() => guardConfig({ DAILY_SPEND_CAP_USD: "-1" })).toThrow(ConfigError);
  });
});

const free = { costUsd: 0, unpricedCalls: 0 };
/** Admit and immediately finish an attack; returns whether it was admitted. */
function once(g: Guard, ip: string, now: number, live = false, spent = free): boolean {
  const d = g.admit(ip, now, live);
  if (d.ok) g.done(d.ticket, spent, now);
  return d.ok;
}

describe("Guard", () => {
  it("limits live attacks per IP per hour, with Retry-After", () => {
    const g = new Guard(cfg({ RATE_LIMIT_PER_HOUR: 2 }));
    expect(once(g, "a", DAY, true)).toBe(true);
    expect(once(g, "a", DAY + 1, true)).toBe(true);
    const no = g.admit("a", DAY + 2, true);
    expect(no).toMatchObject({ ok: false, status: 429 });
    if (!no.ok) expect(no.retryAfterS).toBe(3600);
    expect(once(g, "b", DAY + 2, true)).toBe(true);
    expect(once(g, "a", DAY + 3_600_001, true)).toBe(true);
  });

  it("limits replay attacks per IP per hour on their own, higher limit, without using up live allowance", () => {
    const g = new Guard(cfg({ RATE_LIMIT_PER_HOUR: 1, REPLAY_RATE_LIMIT_PER_HOUR: 3, ATTACKS_PER_IP_PER_DAY: 1 }));
    for (let i = 0; i < 3; i++) expect(once(g, "a", DAY + i, false)).toBe(true);
    expect(g.admit("a", DAY + 3, false)).toMatchObject({ ok: false, status: 429 });
    // Replay used neither the live hourly nor the daily allowance.
    expect(once(g, "a", DAY + 4, true)).toBe(true);
    expect(g.admit("a", DAY + 5, true)).toMatchObject({ ok: false, status: 429 });
    expect(once(g, "a", DAY + 3_600_010, false)).toBe(true);
  });

  it("limits attacks per IP per day, resetting at UTC midnight", () => {
    const g = new Guard(cfg({ RATE_LIMIT_PER_HOUR: 100, ATTACKS_PER_IP_PER_DAY: 2 }));
    expect(once(g, "a", DAY, true)).toBe(true);
    expect(once(g, "a", DAY + 1, true)).toBe(true);
    expect(g.admit("a", DAY + 2, true)).toMatchObject({ ok: false, status: 429, reason: expect.stringMatching(/Daily/) });
    expect(once(g, "a", DAY + 86_400_000, true)).toBe(true);
  });

  it("caps daily model spend for live attacks only", () => {
    const g = new Guard(cfg({ DAILY_SPEND_CAP_USD: 0.5 }));
    expect(once(g, "a", DAY, true, { costUsd: 0.6, unpricedCalls: 0 })).toBe(true);
    expect(g.admit("b", DAY, true)).toMatchObject({ ok: false, status: 503 });
    expect(once(g, "b", DAY, false)).toBe(true); // replay mode costs nothing
    expect(once(g, "c", DAY + 86_400_000, true)).toBe(true);
  });

  it("charges unpriced model calls at a flat rate so they cannot bypass the cap", () => {
    const g = new Guard(cfg({ DAILY_SPEND_CAP_USD: 0.1, UNPRICED_CALL_USD: 0.05 }));
    expect(once(g, "a", DAY, true, { costUsd: 0, unpricedCalls: 2 })).toBe(true);
    expect(g.spendAllowed(DAY)).toBe(false);
  });

  it("reserves each live attack's worst case at admit, so concurrent attacks cannot overshoot the cap", () => {
    const g = new Guard(cfg({ DAILY_SPEND_CAP_USD: 1, MAX_CONCURRENT_ATTACKS: 4 }));
    const tickets = [1, 2, 3, 4].map((i) => g.admit(`ip${i}`, DAY, true, 0.3));
    // Three reservations fit under $1; a fourth would make $1.20.
    expect(tickets.map((t) => t.ok)).toEqual([true, true, true, false]);
    expect(tickets[3]).toMatchObject({ status: 503, reason: expect.stringMatching(/budget/) });
    expect(g.spentUsd(DAY)).toBeCloseTo(0.9);
    // Replay attacks reserve nothing.
    expect(once(g, "replay", DAY, false)).toBe(true);
    // done() replaces each reservation with the actual cost.
    for (const t of tickets) if (t.ok) g.done(t.ticket, { costUsd: 0.1, unpricedCalls: 0 }, DAY);
    expect(g.spentUsd(DAY)).toBeCloseTo(0.3);
    expect(g.admit("ip5", DAY, true, 0.3).ok).toBe(true);
  });

  it("keeps an expired lease's reservation, and does not refund yesterday's reservation from today", () => {
    const g = new Guard(cfg({ DAILY_SPEND_CAP_USD: 1, MAX_CONCURRENT_ATTACKS: 4 }));
    const leaked = g.admit("a", DAY, true, 0.6);
    expect(leaked.ok).toBe(true);
    expect(g.admit("b", DAY + LEASE_MS + 1, true, 0.6).ok).toBe(false); // the killed attack may have spent it
    const late = DAY + 12 * 3_600_000; // after UTC midnight
    if (leaked.ok) g.done(leaked.ticket, { costUsd: 0.2, unpricedCalls: 0 }, late);
    expect(g.spentUsd(late)).toBeCloseTo(0.2);
  });

  it("prices the worst case from the call budget, the token caps and the dearest model", () => {
    const prices = { ultra: { in: 1, out: 3 }, fast: { in: 0.3, out: 0.9 } };
    const perUltraCall = (RESERVE_PROMPT_TOKENS * 1 + RESERVE_COMPLETION_TOKENS * 3) / 1e6;
    expect(worstCaseAttackUsd(8, ["ultra", "fast"], prices, 0.05)).toBeCloseTo(8 * perUltraCall);
    expect(worstCaseAttackUsd(8, ["FAST"], prices, 0.05)).toBeCloseTo((8 * (RESERVE_PROMPT_TOKENS * 0.3 + RESERVE_COMPLETION_TOKENS * 0.9)) / 1e6);
    // An unpriced model is reserved at the flat unpriced rate per call.
    expect(worstCaseAttackUsd(8, ["mystery"], prices, 0.05)).toBeCloseTo(0.4);
  });

  it("caps concurrent attacks, frees the slot on done(), and reclaims leaked slots after the lease", () => {
    const g = new Guard(cfg({ MAX_CONCURRENT_ATTACKS: 1 }));
    const first = g.admit("a", DAY, false);
    expect(first.ok).toBe(true);
    expect(g.admit("b", DAY, false)).toMatchObject({ ok: false, status: 503, reason: expect.stringMatching(/busy/) });
    if (first.ok) g.done(first.ticket, free, DAY);
    expect(g.activeAttacks).toBe(0);
    const leaked = g.admit("b", DAY, false); // never finished: the invocation was killed
    expect(leaked.ok).toBe(true);
    expect(g.admit("c", DAY + LEASE_MS, false).ok).toBe(false);
    expect(g.admit("c", DAY + LEASE_MS + 1, false).ok).toBe(true);
  });

  it("keeps memory bounded by evicting the least recently seen IPs", () => {
    const g = new Guard(cfg());
    for (let i = 0; i < MAX_TRACKED_IPS + 50; i++) once(g, `ip${i}`, DAY);
    expect(g.trackedIps).toBe(MAX_TRACKED_IPS);
  });
});

describe("Semaphore", () => {
  it("never runs more than its capacity at once and runs everything", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 20 }), async (cap, delays) => {
        const s = new Semaphore(cap);
        let active = 0;
        let peak = 0;
        const done = await Promise.all(
          delays.map((d, i) =>
            s.run(async () => {
              active++;
              peak = Math.max(peak, active);
              await new Promise((r) => setTimeout(r, d));
              active--;
              return i;
            }),
          ),
        );
        expect(done).toEqual(delays.map((_, i) => i));
        expect(peak).toBeLessThanOrEqual(cap);
        expect(s.inUse).toBe(0);
      }),
      { numRuns: runs(30) },
    );
  });

  it("hands a released slot to the waiter, so a task arriving after the release still waits", async () => {
    // A runs, B queues, A finishes, then C arrives: B holds the slot it was handed, so C must queue behind it.
    const s = new Semaphore(1);
    let active = 0;
    let peak = 0;
    const order: string[] = [];
    const gates = new Map<string, () => void>();
    const task = (name: string) =>
      s.run(async () => {
        active++;
        peak = Math.max(peak, active);
        order.push(`${name} start`);
        await new Promise<void>((r) => gates.set(name, r));
        order.push(`${name} end`);
        active--;
      });
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const a = task("A");
    const b = task("B");
    await tick();
    expect(order).toEqual(["A start"]);
    expect(peak).toBeLessThanOrEqual(1);
    expect(s.inUse).toBe(1);
    gates.get("A")?.();
    await a;
    await tick();
    expect(order).toEqual(["A start", "A end", "B start"]);
    expect(peak).toBeLessThanOrEqual(1);
    expect(s.inUse).toBe(1);
    const c = task("C");
    await tick();
    expect(peak).toBeLessThanOrEqual(1);
    expect(order).toEqual(["A start", "A end", "B start"]);
    gates.get("B")?.();
    await b;
    await tick();
    expect(peak).toBeLessThanOrEqual(1);
    gates.get("C")?.();
    await c;
    expect(order).toEqual(["A start", "A end", "B start", "B end", "C start", "C end"]);
    expect(peak).toBeLessThanOrEqual(1);
    expect(s.inUse).toBe(0);
  });

  it("releases the slot when the task throws, and validates capacity", async () => {
    const s = new Semaphore(1);
    await expect(s.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(s.tryAcquire()).toBe(true);
    expect(s.tryAcquire()).toBe(false);
    s.release();
    expect(() => new Semaphore(0)).toThrow(RangeError);
  });
});
