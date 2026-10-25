import { attackBodySchema, clientIp, getGuard, MAX_BODY_BYTES, PUBLIC_BUDGETS, readJsonBody } from "@/lib/agent/api";
import { worstCaseAttackUsd, type Guard } from "@/lib/agent/guard";
import { attack, type AttackInput, type StatementInput } from "@/lib/agent/run";
import { makeDeps, resolveMode, type Mode } from "@/lib/agent/setup";
import type { TraceEvent } from "@/lib/agent/trace";
import { ConfigError, errorMessage } from "@/lib/errors";
import { priceTable } from "@/lib/models/pricing";
import { editedKey } from "@/fixtures/replay";
import { BUILT_INS, getProblem } from "@/lib/problems/catalog";

export const maxDuration = 60;

const json = (status: number, error: string, headers: Record<string, string> = {}) => Response.json({ error }, { status, headers });

/** POST /api/attack streams NDJSON: one {"type":"mode"} line, {"type":"event"} lines, then one {"type":"report"} (or {"type":"error"}) line. */
export async function POST(req: Request) {
  // Bounded read first: an oversized body is refused before it is buffered, parsed or rate-limited.
  const read = await readJsonBody(req);
  if (!read.ok) return json(413, `Request body is over ${MAX_BODY_BYTES} bytes.`);
  const parsed = attackBodySchema.safeParse(read.value);
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

  // Reserve the attack's worst-case spend now, so concurrent attacks cannot together overshoot the daily cap.
  const reserveUsd = worstCaseAttackUsd(PUBLIC_BUDGETS.maxModelCalls, [deps.models.reasoningModel, deps.models.fastModel], deps.prices ?? priceTable(), guard.config.UNPRICED_CALL_USD);
  const admitted = guard.admit(clientIp(req.headers), Date.now(), mode === "live", reserveUsd);
  if (!admitted.ok) return json(admitted.status, `${admitted.reason} Retry in ${admitted.retryAfterS}s.`, { "retry-after": String(admitted.retryAfterS) });
  const { ticket } = admitted;
  const spent = { costUsd: 0, unpricedCalls: 0 };
  const release = () => guard.done(ticket, spent, Date.now());

  let input: AttackInput | StatementInput;
  if (builtIn) {
    // Replay has explanations recorded for the demo code only; edited code gets an honest generic one.
    const demo = BUILT_INS.find((b) => b.problem.id === builtIn.id)?.demo;
    const edited = mode === "replay" && demo && (demo.code.trim() !== body.code.trim() || demo.language !== body.language);
    input = {
      problem: builtIn,
      solution: { language: body.language, code: body.code, entry: "solve" },
      research: body.research,
      solutionKey: edited ? editedKey(builtIn.id, demo.language === body.language) : undefined,
    };
  } else {
    // The understand stage types the statement inside the attack: traced, costed and within its budget.
    input = { statement: body.statement ?? "", solution: { language: body.language, code: body.code }, research: body.research };
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
        send({ type: "mode", mode, executor: deps.executor.label, problem: builtIn ? { id: builtIn.id, title: builtIn.title } : { id: "custom", title: "Custom problem" } });
        const report = await attack(input, { ...deps, budgets: PUBLIC_BUDGETS, signal: req.signal, onEvent: (e: TraceEvent) => send({ type: "event", event: e }) });
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
