import { isIPv4, isIPv6 } from "node:net";
import { z } from "zod";
import { BUILT_INS } from "../problems/catalog";
import { Guard, guardConfig } from "./guard";
import type { Mode } from "./setup";

const MAX_STATEMENT_CHARS = 8_000;
const MAX_CODE_CHARS = 20_000;

/** Request body. Anything else is rejected with 400 before any work starts. */
export const attackBodySchema = z
  .object({
    problemId: z.string().min(1).max(64).optional(),
    statement: z.string().max(MAX_STATEMENT_CHARS).optional(),
    // Not trimmed: whitespace is significant in Python.
    code: z.string().max(MAX_CODE_CHARS, "Solutions are limited to 20,000 characters.").refine((c) => c.trim().length > 0, "Paste a solution."),
    language: z.enum(["python", "javascript"]),
    routing: z.enum(["routed", "ultra-only"]).default("routed"),
    research: z.enum(["auto", "force", "off"]).default("auto"),
  })
  .refine((b) => b.problemId !== undefined || (b.statement ?? "").trim().length > 0, { message: "Pick a built-in problem or paste a statement." });

/**
 * Largest request body read: the longest valid body is the statement and the
 * code at their caps, at up to 3 UTF-8 bytes per UTF-16 unit, plus 4 KB for
 * keys, the short fields and JSON escapes (88 KB in all).
 */
export const MAX_BODY_BYTES = (MAX_STATEMENT_CHARS + MAX_CODE_CHARS) * 3 + 4_096;

/**
 * Read a JSON body without ever holding more than `max` bytes: a declared
 * Content-Length over the cap is refused unread, and the stream is cancelled
 * as soon as it passes the cap. Invalid JSON reads as null (the schema rejects it).
 */
export async function readJsonBody(req: Request, max = MAX_BODY_BYTES): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const declared = Number(req.headers.get("content-length") ?? NaN);
  if (declared > max) return { ok: false };
  if (!req.body) return { ok: true, value: null };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return { ok: false };
    }
    chunks.push(value);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: true, value: null };
  }
}

/** Per-attack limits for the public endpoint (tighter than the library defaults). */
export const PUBLIC_BUDGETS = { maxModelCalls: 8, wallClockMs: 50_000 };

let guard: Guard | undefined;
export function getGuard(): Guard {
  guard ??= new Guard(guardConfig());
  return guard;
}

/** For tests: start from a fresh guard with the current env. */
export function resetGuardForTests(): void {
  guard = undefined;
}

/** GET /api/problems payload: the mode and the built-in problems with their demo code (bug notes stay server-side). */
export function problemsPayload(mode: Mode) {
  return { mode, problems: BUILT_INS.map((b) => ({ ...b.problem, demo: { language: b.demo.language, code: b.demo.code, entry: b.demo.entry } })) };
}

/**
 * The client address for per-IP limits. Forwarding headers are only as
 * trustworthy as the proxy that sets them. On Vercel (VERCEL=1) the platform
 * sets x-real-ip and x-vercel-forwarded-for and overwrites x-forwarded-for,
 * dropping what the client sent (vercel.com/docs/headers/request-headers), so
 * all three are the client's address. Behind another proxy
 * (TRUST_PROXY_HEADERS=1) only the right-most X-Forwarded-For entry is the
 * one our proxy appended; everything left of it, and x-real-ip, may come from
 * the client. Anywhere else a client could spoof them, so every client shares one bucket.
 * An IPv6 address is limited by its /64 prefix: one host usually holds a
 * whole /64 and can rotate through it freely.
 */
export function clientIp(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  const rightMost = (h: string) => headers.get(h)?.split(",").at(-1)?.trim() || undefined;
  if (env.VERCEL === "1") return ipBucket(headers.get("x-real-ip")?.trim() || rightMost("x-vercel-forwarded-for") || rightMost("x-forwarded-for") || "unknown");
  if (env.TRUST_PROXY_HEADERS === "1") return ipBucket(rightMost("x-forwarded-for") ?? "unknown");
  return "untrusted-proxy";
}

/** The rate-limit key for an address: IPv4 as is (also when IPv4-mapped), IPv6 as its /64 prefix, anything unparseable as is. */
export function ipBucket(ip: string): string {
  const addr = ip.replace(/%.*$/, "");
  if (isIPv4(addr)) return addr;
  if (!isIPv6(addr)) return ip;
  const [head = "", tail] = addr.toLowerCase().split("::");
  // Hex groups of one side of "::"; a trailing dotted IPv4 part is two groups.
  const groups = (part: string): string[] =>
    part
      ? part.split(":").flatMap((g) => {
          if (!isIPv4(g)) return [g];
          const [a = 0, b = 0, c = 0, d = 0] = g.split(".").map(Number);
          return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
        })
      : [];
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const all = [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right].map((g) => parseInt(g, 16));
  if (all.slice(0, 5).every((g) => g === 0) && all[5] === 0xffff) return [all[6] ?? 0, all[7] ?? 0].flatMap((g) => [g >> 8, g & 0xff]).join(".");
  return `${all.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}
