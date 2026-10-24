import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Guard, guardConfig, LEASE_MS, MAX_TRACKED_IPS } from "@/lib/agent/guard";
import { ConfigError } from "@/lib/errors";
import { Semaphore } from "@/lib/limit";

const DAY = Date.UTC(2026, 9, 24, 12);
const cfg = (over: Partial<ReturnType<typeof guardConfig>> = {}) => ({ ...guardConfig({}), ...over });

describe("guard config", () => {
  it("has defaults and validates env", () => {
    expect(guardConfig({})).toEqual({ RATE_LIMIT_PER_HOUR: 10, ATTACKS_PER_IP_PER_DAY: 30, DAILY_SPEND_CAP_USD: 2, MAX_CONCURRENT_ATTACKS: 4, UNPRICED_CALL_USD: 0.05 });
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
  it("limits attacks per IP per hour, with Retry-After", () => {
    const g = new Guard(cfg({ RATE_LIMIT_PER_HOUR: 2 }));
    expect(once(g, "a", DAY)).toBe(true);
    expect(once(g, "a", DAY + 1)).toBe(true);
    const no = g.admit("a", DAY + 2, false);
    expect(no).toMatchObject({ ok: false, status: 429 });
    if (!no.ok) expect(no.retryAfterS).toBe(3600);
    expect(once(g, "b", DAY + 2)).toBe(true);
    expect(once(g, "a", DAY + 3_600_001)).toBe(true);
  });

  it("limits attacks per IP per day, resetting at UTC midnight", () => {
    const g = new Guard(cfg({ RATE_LIMIT_PER_HOUR: 100, ATTACKS_PER_IP_PER_DAY: 2 }));
    expect(once(g, "a", DAY)).toBe(true);
    expect(once(g, "a", DAY + 1)).toBe(true);
    expect(g.admit("a", DAY + 2, false)).toMatchObject({ ok: false, status: 429, reason: expect.stringMatching(/Daily/) });
    expect(once(g, "a", DAY + 86_400_000)).toBe(true);
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
      { numRuns: 30 },
    );
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
