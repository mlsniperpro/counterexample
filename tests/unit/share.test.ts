import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runs } from "../helpers";
import { attack } from "@/lib/agent/run";
import { mulberry32 } from "@/lib/core/rng";
import { makeDeps } from "@/lib/agent/setup";
import { BUILT_INS } from "@/lib/problems/catalog";
import { decodeReport, encodeReport, fragmentBudget, fromBase64Url, isShareFragment, MAX_LINK_CHARS, SHARE_PREFIX, ShareLinkError, toBase64Url, toShared, type SharedReport } from "@/lib/share";

const deflate = async (text: string) => new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
const deflateBytes = async (bytes: Uint8Array) => new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
const linkFor = async (json: unknown) => SHARE_PREFIX + toBase64Url(await deflate(typeof json === "string" ? json : JSON.stringify(json)));

let real: SharedReport;
async function realReport(): Promise<SharedReport> {
  if (!real) {
    const b = BUILT_INS.find((x) => x.problem.id === "binary-search")!;
    real = toShared(await attack({ problem: b.problem, solution: b.demo }, makeDeps({ mode: "replay", env: { NODE_ENV: "test" } })));
  }
  return real;
}

describe("decodeReport on links of another shape", () => {
  it("says a versioned link is of another format, and a cut-short one is incomplete", async () => {
    const { decodeReport } = await import("@/lib/share");
    await expect(decodeReport("#r=2.abc")).rejects.toThrow(/a format this page does not read/);
    for (const h of ["#r=1", "#r=", "#r=abc"]) await expect(decodeReport(h)).rejects.toThrow(/incomplete or damaged/);
  });
});

describe("share links (report in the URL fragment)", () => {
  it("round-trips a real report, without its trace or oracle code, well under the cap", async () => {
    const r = await realReport();
    expect(r).not.toHaveProperty("trace");
    expect(r).not.toHaveProperty("oracle");
    const enc = await encodeReport(r);
    if (!enc.ok) throw new Error("expected a link");
    expect(enc.fragment.startsWith(SHARE_PREFIX)).toBe(true);
    expect(enc.fragment.length).toBeLessThan(MAX_LINK_CHARS);
    expect(/^#r=1\.[A-Za-z0-9_-]+$/.test(enc.fragment)).toBe(true); // URL-safe, no padding
    expect(await decodeReport(enc.fragment)).toEqual(JSON.parse(JSON.stringify(r)));
  });

  it("round-trips reports of every shape: no counterexample, an unreliable oracle, and a research failure", async () => {
    // A shared link must say what the report said: a survived run has no counterexample, fix, explanation or time to
    // first counterexample, and a failed search keeps its error (or the viewer would read "found no facts").
    const r = await realReport();
    const base = { ...r, counterexample: undefined, fix: undefined, explanation: undefined };
    const shapes = [
      { ...base, verdict: "no_counterexample" as const, stats: { ...r.stats, timeToFirstCounterexampleMs: null }, stages: r.stages.map((s) => ({ ...s, costUsd: null })) },
      { ...base, verdict: "oracle_unreliable" as const, research: undefined },
      { ...r, research: { queries: ["q"], facts: [], influencedFamilies: [], error: "no research client configured (set TAVILY_API_KEY)" } },
    ];
    for (const shape of shapes) {
      const enc = await encodeReport(shape as never);
      if (!enc.ok) throw new Error(`expected a link for ${shape.verdict}`);
      expect(await decodeReport(enc.fragment)).toEqual(JSON.parse(JSON.stringify(toShared(shape as never))));
    }
    const failed = await decodeReport(((await encodeReport(shapes[2] as never)) as { fragment: string }).fragment);
    expect(failed.research?.error).toBe("no research client configured (set TAVILY_API_KEY)");
  });

  it("reads a link made before shrinkExhausted and reattackUnjudged existed with their safe defaults", async () => {
    // Old links lack both fields. They must decode as a counterexample that was shrunk to the end (not "stopped early")
    // and a re-attack with nothing unjudged, or an old link would say something its report never said.
    const old = JSON.parse(JSON.stringify(toShared(await realReport())));
    expect(old.counterexample.shrinkExhausted).toBe(false);
    expect(old.fix.reattackUnjudged).toBe(0);
    delete old.counterexample.shrinkExhausted;
    delete old.fix.reattackUnjudged;
    const stream = new Blob([JSON.stringify(old)]).stream().pipeThrough(new CompressionStream("deflate"));
    const fragment = SHARE_PREFIX + toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
    const decoded = await decodeReport(fragment);
    expect(decoded.counterexample?.shrinkExhausted).toBe(false);
    expect(decoded.fix?.reattackUnjudged).toBe(0);
  });

  it("round-trips any text in the report (unicode, quotes, newlines)", async () => {
    const r = await realReport();
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 300, unit: "grapheme" }), fc.string({ maxLength: 300 }), async (message, code) => {
        const variant = { ...r, message, solution: { ...r.solution, code } };
        const enc = await encodeReport(variant);
        if (!enc.ok) throw new Error("expected a link");
        expect((await decodeReport(enc.fragment)).message).toBe(message);
      }),
      { numRuns: runs(50) },
    );
  });

  it("leaves an order-dependent counterexample's input sequence out of the link, keeping how many inputs came before", async () => {
    const r = await realReport();
    const full = { ...r, counterexample: { ...r.counterexample!, orderDependent: { precedingInputs: 2, sequence: [[1], [2], [3]] } } };
    const shared = toShared(full as never);
    expect(shared.counterexample?.orderDependent).toEqual({ precedingInputs: 2 });
    // The report itself is not modified.
    expect(full.counterexample.orderDependent.sequence).toHaveLength(3);
    const enc = await encodeReport(full as never);
    if (!enc.ok) throw new Error("expected a link");
    expect((await decodeReport(enc.fragment)).counterexample?.orderDependent).toEqual({ precedingInputs: 2 });
    // A counterexample without the field stays without it.
    expect(toShared(r as never).counterexample).not.toHaveProperty("orderDependent");
  });

  it("clamps long display text, keeps a missing expected value, and still round-trips", async () => {
    const r = await realReport();
    const cx = { ...r.counterexample!, got: "x".repeat(10_000) };
    delete (cx as { expected?: unknown }).expected; // the oracle could not judge the minimal input
    const enc = await encodeReport({ ...r, counterexample: cx, explanation: "e".repeat(9_000), message: "m".repeat(5_000) });
    if (!enc.ok) throw new Error(`expected a link, got ${JSON.stringify(enc)}`);
    const back = await decodeReport(enc.fragment);
    expect(back.counterexample?.got).toHaveLength(2000);
    expect(back.counterexample?.got.endsWith(" [truncated]")).toBe(true);
    expect(back.counterexample).not.toHaveProperty("expected");
    expect(back.explanation).toHaveLength(4000);
    expect(back.message).toHaveLength(2000);
  });

  it("refuses (so the UI falls back to a download) a report the decoder would reject", async () => {
    const r = await realReport();
    const bad = { ...r, research: { queries: [], influencedFamilies: [], facts: [{ fact: "x", url: "javascript:alert(1)" }] } };
    expect(await encodeReport(bad)).toEqual({ ok: false, reason: "invalid", detail: "research.facts.0.url" });
  });

  it("budgets the fragment so the whole link fits in 8,000 characters", async () => {
    expect(fragmentBudget("https://counterexample.example", "/")).toBe(MAX_LINK_CHARS - 31);
    expect(fragmentBudget("x".repeat(9000), "/")).toBe(0);
    const r = await realReport();
    const enc = await encodeReport(r, 100);
    expect(enc).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("refuses to make a link for an oversized report (the UI then downloads it instead)", async () => {
    const r = await realReport();
    // Random text barely compresses, so 20,000 characters of it cannot fit in 8,000 link characters.
    const rng = mulberry32(42);
    const noise = Array.from({ length: 20_000 }, () => String.fromCharCode(33 + Math.floor(rng() * 94))).join("");
    const enc = await encodeReport({ ...r, solution: { ...r.solution, code: noise } });
    expect(enc).toEqual({ ok: false, reason: "too_large", length: expect.any(Number) });
    if (!enc.ok && enc.reason === "too_large") expect(enc.length).toBeGreaterThan(MAX_LINK_CHARS);
  });

  it("rejects damaged, foreign or hostile links with a clear reason", async () => {
    const r = await realReport();
    const good = await encodeReport(r);
    if (!good.ok) throw new Error("expected a link");
    const cases: [string, RegExp][] = [
      ["#other", /not a Counterexample report link/],
      [SHARE_PREFIX + "abc$%", /bad characters/],
      [SHARE_PREFIX + "AAAA", /does not decompress/],
      [good.fragment.slice(0, -6) + (good.fragment.endsWith("AAAAAA") ? "BBBBBB" : "AAAAAA"), /damaged|valid report/],
      [SHARE_PREFIX + "A".repeat(MAX_LINK_CHARS), /longer than any report link/],
      [await linkFor("not json"), /not valid JSON/],
      [await linkFor({ verdict: "counterexample" }), /valid report/],
      [await linkFor({ ...r, research: { queries: [], influencedFamilies: [], facts: [{ fact: "x", url: "javascript:alert(1)" }] } }), /valid report \(research\.facts\.0\.url\)/],
    ];
    for (const [hash, re] of cases) {
      const err = await decodeReport(hash).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, hash.slice(0, 40)).toBeInstanceOf(ShareLinkError);
      expect((err as Error).message).toMatch(re);
    }
  });

  it("rejects invalid UTF-8 instead of silently decoding it to U+FFFD", async () => {
    const r = await realReport();
    const bytes = new TextEncoder().encode(JSON.stringify({ ...r, message: "before-MARK-after" }));
    const at = new TextDecoder().decode(bytes).indexOf("MARK");
    bytes[at] = 0xff; // never valid in UTF-8; the rest is a valid report, so only strict decoding can catch it
    const link = SHARE_PREFIX + toBase64Url(await deflateBytes(bytes));
    const err = await decodeReport(link).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShareLinkError);
    expect((err as Error).message).toMatch(/not valid JSON/);
    // The same bytes with the bad byte replaced by a letter are accepted: the report itself is fine.
    bytes[at] = 0x4d;
    expect((await decodeReport(SHARE_PREFIX + toBase64Url(await deflateBytes(bytes)))).message).toBe("before-MARK-after");
  });

  it("stops a decompression bomb before it inflates", async () => {
    const bomb = await linkFor(" ".repeat(5 * 1024 * 1024)); // 5 MB of spaces compresses to a few KB
    expect(bomb.length).toBeLessThan(MAX_LINK_CHARS);
    await expect(decodeReport(bomb)).rejects.toThrow(/too large/);
  });

  it("rejects a deeply nested link with ShareLinkError, not a stack overflow, and keeps ordinary nesting", async () => {
    const r = await realReport();
    const nest = (depth: number) => "[".repeat(depth) + "]".repeat(depth);
    const withArgs = (args: string) => JSON.stringify({ ...r, counterexample: { ...r.counterexample!, args: ["ARGS"] } }).replace('"ARGS"', args);
    const deep = await linkFor(withArgs(nest(10_000)));
    expect(deep.length).toBeLessThan(MAX_LINK_CHARS);
    const err = await decodeReport(deep).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShareLinkError);
    expect((err as Error).message).toMatch(/nested too deeply/);
    const ok = await decodeReport(await linkFor(withArgs(nest(40))));
    expect(JSON.stringify(ok.counterexample?.args)).toBe(`[${nest(40)}]`);
  });

  it("base64url round-trips any bytes and detects share fragments", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2000 }), (bytes) => {
        expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
      }),
    );
    expect(isShareFragment("#r=1.abc")).toBe(true);
    expect(isShareFragment("#r=2.abc")).toBe(false);
    expect(isShareFragment("")).toBe(false);
  });
});
