import type { Language, ChunkResult, RunOutcome } from "./types";

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Wrap user code in a harness that reads {"inputs": [...]} from stdin, calls
 * the entry function on each argument list and writes one JSON line per input
 * to the real stdout. User prints go to stderr so they can't corrupt results.
 * The same program runs in every executor (local subprocess or Judge0).
 */
export function buildProgram(language: Language, code: string, entry: string): string {
  if (!IDENT.test(entry)) throw new Error(`invalid entry function name: ${entry}`);
  if (language === "python") {
    return `${code}

import sys as __cx_sys, json as __cx_json, time as __cx_time
def __cx_main():
    __cx_sys.setrecursionlimit(100000)
    __out = __cx_sys.stdout
    __cx_sys.stdout = __cx_sys.stderr
    __data = __cx_json.loads(__cx_sys.stdin.read())
    __f = ${entry}
    __out.write("\\x1eCR\\n")
    for __args in __data["inputs"]:
        __t0 = __cx_time.perf_counter()
        try:
            __r = __f(*__args)
            __line = __cx_json.dumps({"ok": True, "out": __r, "ms": (__cx_time.perf_counter() - __t0) * 1000})
        except RecursionError as __e:
            __line = __cx_json.dumps({"ok": False, "error": "runtime", "message": "RecursionError: " + str(__e)[:200]})
        except Exception as __e:
            __line = __cx_json.dumps({"ok": False, "error": "runtime", "message": type(__e).__name__ + ": " + str(__e)[:200]})
        __out.write("\\x1eCX" + __line + "\\n")
        __out.flush()
__cx_main()
`;
  }
  return `${code}
;(function __cx_main() {
  const __write = process.stdout.write.bind(process.stdout);
  const __err = (...a) => process.stderr.write(a.map(String).join(" ") + "\\n");
  console.log = __err; console.info = __err; console.warn = __err; console.debug = __err;
  const __data = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const __f = ${entry};
  __write("\\x1eCR\\n");
  for (const __args of __data.inputs) {
    const __t0 = performance.now();
    let __line;
    try {
      const __r = __f(...__args);
      __line = JSON.stringify({ ok: true, out: __r === undefined ? null : __r, ms: performance.now() - __t0 });
    } catch (__e) {
      __line = JSON.stringify({ ok: false, error: "runtime", message: String(__e && __e.stack ? String(__e).slice(0, 200) : __e).slice(0, 200) });
    }
    __write("\\x1eCX" + __line + "\\n");
  }
})();
`;
}

/** True when the harness got as far as loading the code and finding the entry function. */
export function reachedReady(stdout: string): boolean {
  return stdout.includes("\x1eCR");
}

/** Parse harness output. Lines without the record marker are ignored. */
export function parseLines(stdout: string): RunOutcome[] {
  const out: RunOutcome[] = [];
  for (const raw of stdout.split("\n")) {
    const at = raw.indexOf("\x1eCX");
    if (at < 0) continue;
    try {
      const rec = JSON.parse(raw.slice(at + 3));
      if (rec.ok) out.push({ ok: true, out: rec.out, ms: Number(rec.ms) || 0 });
      else out.push({ ok: false, error: "runtime", message: String(rec.message ?? "error") });
    } catch {
      // A line cut off by a kill: the input it belongs to is blamed by the driver.
    }
  }
  return out;
}

/**
 * Run all inputs through repeated chunk invocations. When a process times out
 * or crashes mid-chunk, the input right after the last reported line is
 * blamed and the run restarts after it, so one bad input never loses the rest.
 */
export async function runWithRestarts(
  inputs: unknown[][],
  runChunk: (chunk: unknown[][]) => Promise<ChunkResult>,
  maxChunk = Infinity,
): Promise<{ outcomes: RunOutcome[]; processes: number }> {
  const outcomes: RunOutcome[] = [];
  let processes = 0;
  while (outcomes.length < inputs.length) {
    const start = outcomes.length;
    const chunk = inputs.slice(start, Math.min(inputs.length, start + maxChunk));
    const res = await runChunk(chunk);
    processes++;
    if (res.end === "compile") {
      while (outcomes.length < inputs.length) outcomes.push({ ok: false, error: "compile", message: res.message });
      break;
    }
    outcomes.push(...res.lines.slice(0, chunk.length));
    if (res.lines.length < chunk.length) {
      if (res.end === "ok") {
        outcomes.push({ ok: false, error: "internal", message: res.message || "missing output line" });
      } else {
        outcomes.push({
          ok: false,
          error: res.end === "timeout" ? "timeout" : "runtime",
          message: res.message || res.end,
        });
      }
    }
  }
  return { outcomes, processes };
}
