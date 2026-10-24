import { z } from "zod";
import type { Report } from "./agent/types";

/**
 * Shareable report links. The report is JSON, deflate-compressed with the
 * browser's own CompressionStream (Baseline since 2023) and base64url-encoded
 * into the URL fragment ("#r=1.<data>"). Browsers never send the fragment to
 * the server, so a shared report is decoded only in the reader's browser.
 * Decoding treats the link as untrusted input: size caps before and after
 * decompression, then schema validation (links in the report must be http(s)).
 */

/** What a link carries: the report without its trace and oracle code (download the trace for those). */
export type SharedReport = Omit<Report, "trace" | "oracle">;

export const SHARE_PREFIX = "#r=1.";
/** RFC 9110 recommends supporting URIs of at least 8000 octets; the whole link (origin + path + fragment) stays within that. */
export const MAX_LINK_CHARS = 8000;
/** Decompression cap, so a crafted link cannot inflate into a huge payload. */
export const MAX_DECODED_BYTES = 512 * 1024;

const str = (max: number) => z.string().max(max);
const httpUrl = z.url({ protocol: /^https?$/ });
const count = z.number().int().min(0);

/** Display-text caps: toShared clamps to these and the decoder enforces them. */
const CAP = { message: 2000, got: 2000, explanation: 4000, researchError: 500 } as const;

const sharedReportSchema: z.ZodType<SharedReport> = z.object({
  verdict: z.enum(["counterexample", "no_counterexample", "oracle_unreliable", "compile_error", "budget_exhausted", "error"]),
  message: str(CAP.message),
  problem: z.object({ id: str(64), title: str(200) }),
  solution: z.object({ language: z.enum(["python", "javascript"]), code: str(20_000), entry: str(64) }),
  setup: z.object({ provider: str(40), executor: str(200), research: str(40), routing: str(40), reasoningModel: str(200), fastModel: str(200) }),
  research: z
    .object({
      queries: z.array(str(400)).max(5),
      facts: z.array(z.object({ fact: str(500), url: httpUrl })).max(10),
      influencedFamilies: z.array(str(60)).max(20),
      error: str(CAP.researchError).optional(),
    })
    .optional(),
  families: z
    .array(
      z.object({
        name: str(60),
        rationale: str(400),
        citations: z.array(str(500)).max(10),
        source: z.enum(["examples", "exhaustive", "model", "mutation", "baseline"]),
        generated: count,
        dropped: count,
        tested: count,
        mismatches: count,
        oracleSkipped: count,
      }),
    )
    .max(20),
  counterexample: z
    .object({
      args: z.array(z.json()),
      // Absent when the oracle could not judge the final minimal input.
      expected: z.json().optional(),
      got: str(CAP.got),
      original: z.object({ args: z.array(z.json()), family: str(60) }),
      shrinkSteps: count,
      shrinkEvals: count,
    })
    .optional(),
  explanation: str(CAP.explanation).optional(),
  fix: z.object({ code: str(20_000), verified: z.boolean(), attempts: count, reattackInputs: count, reattackMismatches: count }).optional(),
  stats: z.object({
    modelCalls: count,
    runs: count,
    inputsTested: count,
    wallMs: z.number().min(0),
    timeToFirstCounterexampleMs: z.number().min(0).nullable(),
    costUsd: z.number().min(0),
    unpricedCalls: count,
    simulatedModelMs: z.number().min(0),
  }),
  stages: z
    .array(
      z.object({
        stage: z.enum(["understand", "research", "oracle", "attack", "run", "shrink", "explain", "reattack", "report"]),
        purpose: z.enum(["understand", "research", "oracle", "generators", "explain"]),
        role: z.enum(["reasoning", "fast"]),
        model: str(200),
        why: str(400),
        calls: count,
        promptTokens: count,
        completionTokens: count,
        costUsd: z.number().min(0).nullable(),
        latencyMs: z.number().min(0),
        simulated: z.boolean(),
      }),
    )
    .max(20),
});

export type EncodeResult = { ok: true; fragment: string } | { ok: false; reason: "too_large"; length: number } | { ok: false; reason: "invalid"; detail: string };

export class ShareLinkError extends Error {
  override readonly name = "ShareLinkError";
}

const clamp = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 12) + " [truncated]");

/**
 * The parts of a report that a link (or the fallback download) carries: no
 * trace, no oracle code, nothing beyond the declared solution fields, and long
 * display text clamped (marked "[truncated]").
 */
export function toShared(r: Omit<Report, "trace"> | Report): SharedReport {
  const { trace: _t, oracle: _o, solution, ...rest } = r as Report;
  void _t;
  void _o;
  return {
    ...rest,
    message: clamp(rest.message, CAP.message),
    solution: { language: solution.language, code: solution.code, entry: solution.entry },
    ...(rest.counterexample ? { counterexample: { ...rest.counterexample, got: clamp(rest.counterexample.got, CAP.got) } } : {}),
    ...(rest.explanation !== undefined ? { explanation: clamp(rest.explanation, CAP.explanation) } : {}),
    ...(rest.research ? { research: { ...rest.research, ...(rest.research.error !== undefined ? { error: clamp(rest.research.error, CAP.researchError) } : {}) } } : {}),
  };
}

/**
 * Encode a report as a URL fragment. Refuses (so the caller can fall back to a
 * download) when the fragment would exceed maxFragmentChars, or when the
 * report would not pass the decoder's own validation.
 */
export async function encodeReport(r: Omit<Report, "trace"> | Report, maxFragmentChars = MAX_LINK_CHARS): Promise<EncodeResult> {
  const shared = toShared(r);
  const check = sharedReportSchema.safeParse(JSON.parse(JSON.stringify(shared)));
  if (!check.success) return { ok: false, reason: "invalid", detail: check.error.issues[0]?.path.join(".") || "root" };
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(shared)), new CompressionStream("deflate"));
  const fragment = SHARE_PREFIX + toBase64Url(bytes);
  return fragment.length <= maxFragmentChars ? { ok: true, fragment } : { ok: false, reason: "too_large", length: fragment.length };
}

/** Fragment budget for a link on this page: the whole URL stays within MAX_LINK_CHARS. */
export function fragmentBudget(origin: string, pathname: string): number {
  return Math.max(0, MAX_LINK_CHARS - origin.length - pathname.length);
}

/** True when a URL fragment looks like a shared report. */
export function isShareFragment(hash: string): boolean {
  return hash.startsWith(SHARE_PREFIX);
}

/** Decode and validate a shared-report fragment. Throws ShareLinkError with a user-facing reason. */
export async function decodeReport(hash: string): Promise<SharedReport> {
  if (!isShareFragment(hash)) throw new ShareLinkError("not a Counterexample report link");
  if (hash.length > MAX_LINK_CHARS) throw new ShareLinkError("the link is longer than any report link can be");
  let bytes: Uint8Array;
  try {
    bytes = await pipe(fromBase64Url(hash.slice(SHARE_PREFIX.length)), new DecompressionStream("deflate"), MAX_DECODED_BYTES);
  } catch (e) {
    throw new ShareLinkError(e instanceof ShareLinkError ? e.message : "the link is damaged (it does not decompress)");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ShareLinkError("the link is damaged (not valid JSON)");
  }
  const parsed = sharedReportSchema.safeParse(json);
  if (!parsed.success) throw new ShareLinkError(`the link does not contain a valid report (${parsed.error.issues[0]?.path.join(".") || "root"})`);
  return parsed.data;
}

async function pipe(input: Uint8Array, transform: CompressionStream | DecompressionStream, maxBytes = Infinity): Promise<Uint8Array> {
  const reader = new Blob([input as BlobPart]).stream().pipeThrough(transform).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ShareLinkError("the report in the link is too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new ShareLinkError("the link is damaged (bad characters)");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new ShareLinkError("the link is damaged (bad encoding)");
  }
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
