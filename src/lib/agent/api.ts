import { z } from "zod";
import { BUILT_INS } from "../problems/catalog";
import { Guard, guardConfig } from "./guard";
import type { Mode } from "./setup";

/** Request body. Anything else is rejected with 400 before any work starts. */
export const attackBodySchema = z
  .object({
    problemId: z.string().min(1).max(64).optional(),
    statement: z.string().max(8_000).optional(),
    // Not trimmed: whitespace is significant in Python.
    code: z.string().max(20_000, "Solutions are limited to 20,000 characters.").refine((c) => c.trim().length > 0, "Paste a solution."),
    language: z.enum(["python", "javascript"]),
    routing: z.enum(["routed", "ultra-only"]).default("routed"),
    research: z.enum(["auto", "force", "off"]).default("auto"),
  })
  .refine((b) => b.problemId !== undefined || (b.statement ?? "").trim().length > 0, { message: "Pick a built-in problem or paste a statement." });

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
 * trustworthy as the proxy that sets them: Vercel sets x-real-ip and
 * overwrites x-forwarded-for, so they are trusted on Vercel (VERCEL=1) or
 * behind another proxy that does the same (TRUST_PROXY_HEADERS=1). Anywhere
 * else a client could spoof them, so every client shares one bucket.
 */
export function clientIp(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL !== "1" && env.TRUST_PROXY_HEADERS !== "1") return "untrusted-proxy";
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
