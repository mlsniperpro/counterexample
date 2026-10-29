import { describe, expect, it } from "vitest";
import { attackRun } from "@/app/attack-run";
import { initialRun, NO_DETAILS_MESSAGE, runReducer, TIMED_OUT, TIMEOUT_MESSAGE, UNREACHABLE_MESSAGE } from "@/app/run-state";
import { CUT_MESSAGE, UNREADABLE_MESSAGE, type StreamMsg } from "@/app/stream";
import { fullReport, line, traceEvent } from "../app-fixtures";

/** A response body that delivers its chunks and then stays open (the server is still attacking), recording a cancel. */
const openBody = (...chunks: string[]) => {
  const seen = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(new TextEncoder().encode(s));
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { stream, seen };
};

const mode = JSON.stringify({ type: "mode", executor: "local" });
const event = JSON.stringify({ type: "event", event: { seq: 0, t: 0, stage: "run", kind: "info", msg: "hi" } });

/** Play a whole run through attackRun and the reducer, as the component does. */
async function play(fetchImpl: typeof fetch, timeoutMs?: number) {
  const controller = new AbortController();
  const msgs: StreamMsg[] = [];
  let s = runReducer(initialRun, { type: "start", runId: 1 });
  const outcome = await attackRun({
    controller,
    body: { problemId: "x" },
    onMsg: (msg) => {
      msgs.push(msg);
      s = runReducer(s, { type: "msg", runId: 1, msg });
    },
    fetchImpl,
    timeoutMs,
  });
  s = runReducer(s, { type: "finish", runId: 1, outcome });
  return { s, msgs, outcome, controller };
}

describe("attackRun (fetch, stream and teardown of one attack)", () => {
  it("on a malformed line (a proxy's HTML page), aborts the controller, cancels the reader and shows a readable error", async () => {
    const { stream, seen } = openBody(`${mode}\n${event}\n<!doctype html><html><body>502 Bad Gateway</body></html>\n`);
    const { s, msgs, controller } = await play(async () => new Response(stream));
    expect(msgs.map((m) => m.type)).toEqual(["mode", "event"]);
    expect(controller.signal.aborted).toBe(true);
    expect(seen.cancelled).toBe(true);
    expect(s).toMatchObject({ running: false, error: UNREADABLE_MESSAGE });
    expect(s.error).not.toMatch(/SyntaxError|JSON/);
    expect(s.events).toHaveLength(1);
  });

  it("stops at the client deadline and shows the timeout message with the partial trace", async () => {
    const { stream } = openBody(`${event}\n`);
    const { s, controller } = await play(async (_url, init) => {
      const signal = init?.signal as AbortSignal;
      // The body errors when the request is aborted, as a real fetch body does.
      const body = stream.pipeThrough(new TransformStream(), { signal });
      return new Response(body);
    }, 30);
    expect(controller.signal.reason).toBe(TIMED_OUT);
    expect(s).toMatchObject({ running: false, error: TIMEOUT_MESSAGE });
    expect(s.events).toHaveLength(1);
  });

  it("aborts the controller after a complete run too, and reports a cut stream", async () => {
    const report = JSON.stringify({ type: "report", report: fullReport({ verdict: "no_counterexample", message: "ok" }) });
    const done = await play(async () => new Response(`${mode}\n${report}\n`));
    expect(done.outcome).toEqual({ complete: true });
    expect(done.controller.signal.aborted).toBe(true);
    expect(done.s.error).toBe("");
    const cut = await play(async () => new Response(`${mode}\n${event}\n`));
    expect(cut.s.error).toBe(CUT_MESSAGE);
  });

  it("shows the server's error for a refused request (e.g. rate limited)", async () => {
    const { s } = await play(async () => Response.json({ error: "Too many attacks from this address." }, { status: 429 }));
    expect(s.error).toBe("Too many attacks from this address.");
    const html = await play(async () => new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    expect(html.s.error).toBe("The server returned HTTP 502.");
  });

  it("always shows a readable message for a refusal, whatever the proxy or server sent", async () => {
    // Over HTTP/2 statusText is "": the status code must be what the user reads.
    const empty = await play(async () => new Response("<html>gateway timeout</html>", { status: 504, statusText: "" }));
    expect(empty.s.error).toBe("The server returned HTTP 504.");
    const noBody = await play(async () => new Response(null, { status: 502 }));
    expect(noBody.s.error).toBe("The server returned HTTP 502.");
    for (const error of ["", "   ", null, 42, { code: "x" }, ["a"]]) {
      const r = await play(async () => Response.json({ error }, { status: 500 }));
      expect(r.s.error, JSON.stringify(error)).toBe("The server returned HTTP 500.");
      expect(r.s.error).not.toMatch(/object/i);
    }
    expect((await play(async () => Response.json({}, { status: 429 }))).s.error).toBe("The server returned HTTP 429.");
  });

  it("gives a 200 response without a body a readable error instead of a TypeError", async () => {
    const { s } = await play(async () => new Response(null, { status: 200 }));
    expect(s.error).toBe("The server sent an empty response.");
    expect(s.running).toBe(false);
  });

  it("shows a message for an error line with no text, and rejects an error line whose text is not a string", async () => {
    for (const error of ["", "  "]) {
      const { s } = await play(async () => new Response(`${mode}\n${line({ type: "error", error })}`));
      expect(s, JSON.stringify(error)).toMatchObject({ running: false, error: NO_DETAILS_MESSAGE });
    }
    const object = await play(async () => new Response(`${mode}\n${line({ type: "error", error: { code: 1 } })}`));
    expect(object.s.error).toBe(UNREADABLE_MESSAGE);
  });

  it("maps a connection that fails to start to 'Could not reach the server.'", async () => {
    const { s } = await play(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(s).toMatchObject({ running: false, error: UNREACHABLE_MESSAGE });
  });

  it("maps a connection reset mid-stream to the cut message, keeping the partial trace", async () => {
    const reset = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(`${mode}\n${line({ type: "event", event: traceEvent(0) })}`));
      },
      pull() {
        throw new TypeError("network error");
      },
    });
    const { s } = await play(async () => new Response(reset));
    expect(s).toMatchObject({ running: false, error: CUT_MESSAGE });
    expect(s.error).not.toMatch(/network error/);
    expect(s.events).toHaveLength(1);
  });

  it("ends the run at the report even if the server then stalls: no timeout, no error, the stream is closed", async () => {
    const { stream, seen } = openBody(`${mode}\n${line({ type: "report", report: fullReport({ verdict: "no_counterexample" }) })}`);
    const { s, outcome, controller } = await play(async () => new Response(stream), 5_000);
    expect(outcome).toEqual({ complete: true });
    expect(s).toMatchObject({ running: false, error: "", note: "" });
    expect(s.report?.verdict).toBe("no_counterexample");
    expect(seen.cancelled).toBe(true);
    expect(controller.signal.reason).not.toBe(TIMED_OUT);
  });
});
