import { checkRateLimit, recordSpend, spendAllowed } from "@/lib/agent/guard";
import { attack } from "@/lib/agent/run";
import { makeDeps, resolveMode } from "@/lib/agent/setup";
import type { TraceEvent } from "@/lib/agent/trace";
import { understandProblem } from "@/lib/agent/understand";
import type { Language } from "@/lib/exec/types";
import { getProblem } from "@/lib/problems/catalog";

export const maxDuration = 60;

type Body = {
  problemId?: string;
  statement?: string;
  code?: string;
  language?: Language;
  routing?: "routed" | "ultra-only";
  research?: "auto" | "force" | "off";
};

const bad = (status: number, error: string, headers: Record<string, string> = {}) => Response.json({ error }, { status, headers });

/** POST /api/attack streams NDJSON: {"type":"event",...} lines, then one {"type":"report",...}. */
export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const rl = checkRateLimit(ip);
  if (!rl.ok) return bad(429, `Rate limit reached, retry in ${rl.retryAfterS}s.`, { "retry-after": String(rl.retryAfterS) });

  const body = (await req.json().catch(() => ({}))) as Body;
  const code = String(body.code ?? "");
  const language: Language = body.language === "javascript" ? "javascript" : "python";
  if (!code.trim() || code.length > 20_000) return bad(400, "Paste a solution (up to 20k characters).");

  const mode = resolveMode();
  if (mode === "live" && !spendAllowed()) return bad(503, "Today's model budget for this demo is spent. Try replay mode or come back tomorrow.");

  let deps;
  try {
    deps = makeDeps({ mode, routing: body.routing === "ultra-only" ? "ultra-only" : "routed" });
  } catch (e) {
    return bad(503, (e as Error).message);
  }

  let problem = body.problemId ? getProblem(body.problemId) : undefined;
  let entry = "solve";
  if (!problem) {
    if (mode === "replay") return bad(400, "Replay mode (no NEBIUS_API_KEY) only covers the built-in problems.");
    const statement = String(body.statement ?? "").slice(0, 8_000);
    if (!statement.trim()) return bad(400, "Paste a problem statement.");
    try {
      ({ problem, entry } = await understandProblem(statement, { code, language }, deps.provider, deps.models));
    } catch (e) {
      return bad(422, `Could not turn the statement into a typed spec: ${(e as Error).message}`);
    }
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      send({ type: "mode", mode, executor: deps.executor.label, problem: { id: problem.id, title: problem.title } });
      const report = await attack(
        { problem: problem!, solution: { language, code, entry }, research: body.research ?? "auto" },
        { ...deps, budgets: { maxModelCalls: 8, wallClockMs: 50_000 }, onEvent: (e: TraceEvent) => send({ type: "event", event: e }) },
      );
      if (mode === "live") recordSpend(report.stats.costUsd);
      const { trace: _trace, ...rest } = report;
      void _trace;
      send({ type: "report", report: rest });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
