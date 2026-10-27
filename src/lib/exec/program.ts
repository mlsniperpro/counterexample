import { exactReviver } from "../core/compare";
import type { Language, ChunkResult, RunOutcome } from "./types";

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Wrap user code in a harness that reads {"inputs": [...]} from stdin, calls
 * the entry function on each argument list and writes one JSON line per input
 * to the real stdout. User prints go to stderr so they can't corrupt results.
 * Non-finite floats are written as the strings "Infinity", "-Infinity" and
 * "NaN" in both languages, since JSON has no such numbers.
 * The same program runs in every executor (local subprocess or Judge0).
 */
export function buildProgram(language: Language, code: string, entry: string): string {
  if (!IDENT.test(entry)) throw new Error(`invalid entry function name: ${entry}`);
  if (language === "python") {
    // The code runs as its own module named "solution", so an `if __name__ == "__main__":` block stays inert.
    const source = Buffer.from(code, "utf8").toString("base64");
    return `import sys as __cx_sys, json as __cx_json, time as __cx_time, inspect as __cx_inspect, math as __cx_math, types as __cx_types, base64 as __cx_b64
__cx_mod = __cx_types.ModuleType("solution")
__cx_mod.__file__ = "solution.py"
__cx_sys.modules["solution"] = __cx_mod
exec(compile(__cx_b64.b64decode("${source}").decode("utf-8"), "solution.py", "exec"), __cx_mod.__dict__)
def __cx_finite(v):
    if isinstance(v, float) and not __cx_math.isfinite(v):
        return "NaN" if v != v else ("Infinity" if v > 0 else "-Infinity")
    if isinstance(v, (list, tuple)):
        return [__cx_finite(x) for x in v]
    if isinstance(v, dict):
        return {k: __cx_finite(x) for k, x in v.items()}
    return v
def __cx_dumps(v):
    try:
        return __cx_json.dumps(v, allow_nan=False)
    except ValueError:
        return __cx_json.dumps(__cx_finite(v), allow_nan=False)
def __cx_main():
    __cx_sys.setrecursionlimit(100000)
    __out = __cx_sys.stdout
    __cx_sys.stdout = __cx_sys.stderr
    __data = __cx_json.loads(__cx_sys.stdin.read())
    __f = getattr(__cx_mod, "${entry}")
    __out.write("\\x1eCR\\n")
    __out.flush()
    for __args in __data["inputs"]:
        __t0 = __cx_time.perf_counter()
        try:
            __r = __f(*__args)
            if __cx_inspect.isawaitable(__r):
                raise TypeError("the function returned a coroutine: make it synchronous (async solutions are not supported)")
            __line = __cx_dumps({"ok": True, "out": __r, "ms": round((__cx_time.perf_counter() - __t0) * 1000, 3)})
        except RecursionError as __e:
            __line = __cx_json.dumps({"ok": False, "error": "runtime", "message": "RecursionError: " + str(__e)[:200]})
        except Exception as __e:
            __line = __cx_json.dumps({"ok": False, "error": "runtime", "message": type(__e).__name__ + ": " + str(__e)[:200]})
        __out.write("\\x1eCX" + __line + "\\n")
        __out.flush()
__cx_main()
`;
  }
  // ES module exports would not load as a script; the function itself is all the harness needs.
  return `${code.replace(/^export\s+(default\s+)?/gm, "")}
;(function __cx_main() {
  const __write = process.stdout.write.bind(process.stdout);
  const __err = (...a) => process.stderr.write(a.map(String).join(" ") + "\\n");
  console.log = __err; console.info = __err; console.warn = __err; console.debug = __err;
  const __data = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const __f = ${entry};
  // perf_hooks, not the global: Judge0 CE's default JavaScript is Node 12, which has no global performance.
  const __perf = require("perf_hooks").performance;
  // A BigInt, or a number too large to be exact, is written as its exact plain digits (JSON has no BigInt; the parser keeps big integers exact,
  // and a number's shortest text, e.g. 1152921504606847000 for 2**60, would read back as digits it does not have).
  const __finite = (k, v) => (typeof v === "bigint" ? "\\u0000BIG" + v.toString() : typeof v === "number" && Number.isInteger(v) && !Number.isSafeInteger(v) ? "\\u0000BIG" + BigInt(v).toString() : typeof v === "number" && !Number.isFinite(v) ? String(v) : v);
  // Only a marker standing where a JSON value stands (after [ , : or at the start, before , ] } or the end) is a number: a quote inside a string is
  // always escaped, so a string output that merely contains a quote, a NUL and "BIG5" is left alone.
  const __digits = (s) => s.replace(/(^|[\\[,:])"\\\\u0000BIG(-?\\d+)"(?=[,\\]}]|$)/g, "$1$2");
  __write("\\x1eCR\\n");
  for (const __args of __data.inputs) {
    const __t0 = __perf.now();
    let __line;
    try {
      const __r = __f(...__args);
      if (__r && typeof __r.then === "function") throw new Error("the function returned a Promise: make it synchronous (async solutions are not supported)");
      __line = __digits(JSON.stringify({ ok: true, out: __r === undefined ? null : __r, ms: Math.round((__perf.now() - __t0) * 1000) / 1000 }, __finite));
    } catch (__e) {
      __line = JSON.stringify({ ok: false, error: "runtime", message: String(__e && __e.stack ? String(__e).slice(0, 200) : __e).slice(0, 200) });
    }
    __write("\\x1eCX" + __line + "\\n");
  }
})();
`;
}

/** Longest result line (one input's JSON record) that is parsed; larger results are refused as runtime errors. */
export const MAX_RESULT_CHARS = 256_000;

/** Total result characters parsed per run (one process or submission); results past it are refused unread. */
export const MAX_RESULTS_TOTAL_CHARS = 1_000_000;

/** Deepest nesting of arrays and objects in a result; deeper values would overflow the stack when compared or shown. */
export const MAX_RESULT_DEPTH = 256;

/** Maximum bracket nesting of JSON text, ignoring brackets inside strings (linear, no recursion). */
function nestingDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i++; // backslash: skip the escaped character
      else if (c === 34) inString = false;
    } else if (c === 34) inString = true;
    else if (c === 91 || c === 123) max = Math.max(max, ++depth);
    else if (c === 93 || c === 125) depth--;
  }
  return max;
}

/** 16+ digits that start a number (not the tail of a longer run, not a fraction): the shortest literal that can exceed 2^53 (9007199254740992 has 16). */
const BIG_DIGITS = /(?<![\d.])\d{16}/;

/**
 * Whether a record line could hold a big integer in its result. Only the part
 * before the record's last `"ms":` is looked at: the timing is a float with 16+
 * fraction digits, which made every line look big and sent it through the
 * several-times-slower exact reviver. (A `"ms":` inside a result is a key and
 * the record's own comes last, and inside a string its quotes are escaped.)
 */
function mayHoldBigInteger(text: string): boolean {
  const end = text.lastIndexOf('"ms":');
  return BIG_DIGITS.test(end < 0 ? text : text.slice(0, end));
}

/** True when the harness got as far as loading the code and finding the entry function. */
export function reachedReady(stdout: string): boolean {
  return stdout.includes("\x1eCR");
}

/**
 * Parse harness output. Lines without the record marker are ignored. A
 * complete record line that cannot be read still yields an outcome (an
 * internal error), so every later result stays aligned with its input; only a
 * final line cut off by a kill is dropped, and the driver blames its input.
 * Reading stops after `maxRecords` records (the chunk's input count): code
 * that writes to stdout directly can forge millions of empty records, which
 * no byte cap counts but each costs a parse.
 */
export function parseLines(stdout: string, maxRecords = Infinity): RunOutcome[] {
  const out: RunOutcome[] = [];
  let accepted = 0;
  // Jump from marker to marker: walking every line cost about 0.5 s per 8 MB of bare newlines, once per process.
  for (let start = 0; out.length < maxRecords; ) {
    const at = stdout.indexOf("\x1eCX", start);
    if (at < 0) break;
    const nl = stdout.indexOf("\n", at);
    const complete = nl >= 0;
    const text = stdout.slice(at + 3, complete ? nl : stdout.length);
    start = complete ? nl + 1 : stdout.length;
    // Parsing and comparing a result costs server CPU on the event loop (about 1 s per MB), so a huge result,
    // or results past one run's total budget, are refused unread: a complete line still yields an outcome,
    // keeping later results aligned with their inputs. The final line (no newline after it, as when the
    // process was killed mid-write, or wrote it without one on purpose) gets the same limits; over them it is
    // dropped like any cut-off line, and the driver blames its input.
    const refuse = (message: string) => {
      if (complete) out.push({ ok: false, error: "runtime", message });
    };
    if (text.length > MAX_RESULT_CHARS) {
      refuse(`result too large (${text.length} characters; the limit is ${MAX_RESULT_CHARS})`);
      continue;
    }
    if (accepted + text.length > MAX_RESULTS_TOTAL_CHARS) {
      refuse(`results too large in total (this run's results passed ${MAX_RESULTS_TOTAL_CHARS} characters)`);
      continue;
    }
    accepted += text.length;
    // The record itself ({"ok":…,"out":…}) is one level; the limit is on the result inside it.
    if (nestingDepth(text) - 1 > MAX_RESULT_DEPTH) {
      refuse(`result nested too deeply (more than ${MAX_RESULT_DEPTH} levels)`);
      continue;
    }
    try {
      // The exact-integer reviver is several times slower than a plain parse, so it runs only when a long digit run could be a big integer.
      const rec = JSON.parse(text, mayHoldBigInteger(text) ? exactReviver : undefined);
      if (rec.ok) out.push({ ok: true, out: rec.out, ms: Number(rec.ms) || 0 });
      else out.push({ ok: false, error: "runtime", message: String(rec.message ?? "error") });
    } catch {
      if (complete) out.push({ ok: false, error: "internal", message: "unreadable result line" });
    }
  }
  return out;
}

/**
 * Run all inputs through repeated chunk invocations. When a process times out
 * or crashes mid-chunk, the input right after the last reported line is
 * blamed and the run restarts after it, so one bad input never loses the rest.
 * With `perInputLimitMs` (an executor whose time limit covers the whole chunk,
 * like Judge0), more rules apply. A timeout or crash in a multi-input chunk is
 * only blamed on that input after it also fails alone: the shared budget
 * (or memory) can run out on slow but legal runs of earlier inputs, and
 * blaming an innocent input would turn a correct solution into a false alarm.
 * Such a failure also halves the chunk size for the rest of the run (down to
 * 1): each hanging input costs a whole shared budget plus a solo run, so
 * smaller chunks keep the next one cheaper. And an input whose own measured
 * time is over the limit, though the chunk as a whole finished in time, is a
 * timeout too, once it is over the limit alone as well.
 */
export async function runWithRestarts(
  inputs: unknown[][],
  runChunk: (chunk: unknown[][]) => Promise<ChunkResult>,
  maxChunk = Infinity,
  perInputLimitMs?: number,
): Promise<{ outcomes: RunOutcome[]; processes: number }> {
  const sharedTimeLimit = perInputLimitMs !== undefined;
  const outcomes: RunOutcome[] = [];
  let processes = 0;
  let chunkSize = maxChunk;
  while (outcomes.length < inputs.length) {
    const start = outcomes.length;
    const chunk = inputs.slice(start, Math.min(inputs.length, start + chunkSize));
    const res = await runChunk(chunk);
    processes++;
    if (res.end === "compile") {
      while (outcomes.length < inputs.length) outcomes.push({ ok: false, error: "compile", message: res.message });
      break;
    }
    for (const [i, line] of res.lines.slice(0, chunk.length).entries()) {
      outcomes.push(sharedTimeLimit && line.ok && line.ms > perInputLimitMs ? await confirmSlow(chunk[i] as unknown[], chunk.length, line) : line);
    }
    if (res.lines.length >= chunk.length) continue;
    let end = res.end;
    let message = res.message;
    if (sharedTimeLimit && (end === "timeout" || end === "crash") && chunk.length > 1) {
      chunkSize = Math.max(1, Math.floor(Math.min(chunkSize, chunk.length) / 2));
      const blamed = chunk[res.lines.length] as unknown[];
      const solo = await runChunk([blamed]);
      processes++;
      const line = solo.lines[0];
      if (line) {
        outcomes.push(overLimit(line) ? timedOut(line) : line);
        continue;
      }
      if (solo.end === "compile") {
        outcomes.push({ ok: false, error: "compile", message: solo.message });
        continue;
      }
      end = solo.end;
      message = solo.message;
    }
    if (end === "ok") {
      outcomes.push({ ok: false, error: "internal", message: message || "missing output line" });
    } else {
      outcomes.push({ ok: false, error: end === "timeout" ? "timeout" : "runtime", message: message || end });
    }
  }
  return { outcomes, processes };

  /** An input over its own limit inside a chunk that finished: re-run it alone (unless it was alone) before calling it a timeout. */
  async function confirmSlow(args: unknown[], chunkLength: number, line: RunOutcome): Promise<RunOutcome> {
    let again = line;
    if (chunkLength > 1) {
      const solo = await runChunk([args]);
      processes++;
      again = solo.lines[0] ?? { ok: false, error: solo.end === "timeout" ? "timeout" : "runtime", message: solo.message || solo.end };
    }
    return overLimit(again) ? timedOut(again) : again;
  }

  function overLimit(o: RunOutcome): o is Extract<RunOutcome, { ok: true }> {
    return o.ok && o.ms > (perInputLimitMs ?? Infinity);
  }

  function timedOut(o: Extract<RunOutcome, { ok: true }>): RunOutcome {
    return { ok: false, error: "timeout", message: `time limit ${perInputLimitMs}ms exceeded (took ${Math.round(o.ms)}ms)` };
  }
}
