import { attackBodySchema, getGuard, PUBLIC_BUDGETS, spentBy } from "@/lib/agent/api";
import type { Guard } from "@/lib/agent/guard";
import { attack } from "@/lib/agent/run";
import { makeDeps, resolveMode, type Mode } from "@/lib/agent/setup";
import type { TraceEvent } from "@/lib/agent/trace";
import { understandProblem } from "@/lib/agent/understand";
import { AppError, ConfigError, errorMessage } from "@/lib/errors";
import { priceTable } from "@/lib/models/pricing";
import { editedKey } from "@/fixtures/replay";
import { BUILT_INS, getProblem } from "@/lib/problems/catalog";
import type { Problem } from "@/lib/problems/types";

export const maxDuration = 60;

const json = (status: number, error: string, headers: Record<string, string> = {}) => Response.json({ error }, { status, headers });

/** Vercel sets x-real-ip and overwrites x-forwarded-for; elsewhere this is only as trustworthy as the proxy in front. */
function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** POST /api/attack streams NDJSON: one {"type":"mode"} line, {"type":"event"} lines, then one {"type":"report"} (or {"type":"error"}) line. */
export async function POST(req: Request) {
  const parsed = attackBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, parsed.error.issues.map((i) => i.message).join(" "));
  const body = parsed.data;

  let mode: Mode;
  let deps: ReturnType<typeof makeDeps>;
  let guard: Guard;
  try {
    mode = resolveMode();
    deps = makeDeps({ mode, routing: body.routing });
    guard = getGuard();
  } catch (e) {
    if (!(e instanceof ConfigError)) console.error("attack setup failed", e);
    return json(503, e instanceof ConfigError ? `Server misconfigured: ${e.message}` : "Server unavailable.");
  }

  const builtIn = body.problemId === undefined ? undefined : getProblem(body.problemId);
  if (body.problemId !== undefined && !builtIn) return json(400, `Unknown problem "${body.problemId}".`);
  if (!builtIn && mode === "replay") return json(400, "Replay mode (no NEBIUS_API_KEY on the server) only covers the built-in problems.");

  const admitted = guard.admit(clientIp(req), Date.now(), mode === "live");
  if (!admitted.ok) return json(admitted.status, `${admitted.reason} Retry in ${admitted.retryAfterS}s.`, { "retry-after": String(admitted.retryAfterS) });
  const { ticket } = admitted;
  const spent = { costUsd: 0, unpricedCalls: 0 };
  const release = () => guard.done(ticket, spent, Date.now());

  let problem: Problem;
  let entry = "solve";
  let solutionKey: string | undefined;
  if (builtIn) {
    problem = builtIn;
    // Replay has explanations recorded for the demo code only; edited code gets an honest generic one.
    const demo = BUILT_INS.find((b) => b.problem.id === builtIn.id)?.demo;
    if (mode === "replay" && demo && (demo.code.trim() !== body.code.trim() || demo.language !== body.language)) {
      solutionKey = editedKey(builtIn.id, demo.language === body.language);
    }
  } else {
    try {
      const u = await understandProblem(body.statement ?? "", { code: body.code, language: body.language }, deps.provider, deps.models, req.signal);
      Object.assign(spent, spentBy(u.response, deps.prices ?? priceTable()));
      ({ problem, entry } = u);
    } catch (e) {
      release();
      if (!(e instanceof AppError)) console.error("understand failed", e);
      return json(422, `Could not turn the statement into a typed spec: ${e instanceof AppError ? e.message : "unexpected error"}`);
    }
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (o: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        } catch {
          open = false; // client went away; req.signal stops the attack
        }
      };
      try {
        send({ type: "mode", mode, executor: deps.executor.label, problem: { id: problem.id, title: problem.title } });
        const report = await attack(
          { problem, solution: { language: body.language, code: body.code, entry }, research: body.research, solutionKey },
          { ...deps, budgets: PUBLIC_BUDGETS, signal: req.signal, onEvent: (e: TraceEvent) => send({ type: "event", event: e }) },
        );
        spent.costUsd += report.stats.costUsd;
        spent.unpricedCalls += report.stats.unpricedCalls;
        const { trace: _omit, ...rest } = report;
        void _omit;
        send({ type: "report", report: rest });
      } catch (e) {
        // attack() turns failures into verdicts; reaching here is a bug, so log it.
        console.error("attack crashed", e);
        send({ type: "error", error: errorMessage(e) });
      } finally {
        release();
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
