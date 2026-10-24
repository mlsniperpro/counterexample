import { z } from "zod";
import { costUsd, type Price } from "../models/pricing";
import type { ModelResponse } from "../models/types";
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

/** What one model call adds to the daily spend: its price, or "unpriced" (charged at a flat rate by the guard). */
export function spentBy(res: ModelResponse, prices: Record<string, Price>): { costUsd: number; unpricedCalls: number } {
  const cost = costUsd(res.model, res.promptTokens, res.completionTokens, prices);
  return cost === null ? { costUsd: 0, unpricedCalls: 1 } : { costUsd: cost, unpricedCalls: 0 };
}
