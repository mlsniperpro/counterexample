import { z } from "zod";
import { ReplayMissError, UpstreamError } from "../errors";
import { DEFAULT_RETRY, postJson, type HttpDeps, type RetryPolicy } from "../net/http";

export type SearchResult = { title: string; url: string; content: string };
export type ResearchFact = { fact: string; url: string };
/** Usable results, and how many results were dropped as malformed (reported, not hidden). */
export type SearchResponse = { results: SearchResult[]; dropped: number };

export interface ResearchClient {
  readonly name: "tavily" | "replay";
  search(query: string, signal?: AbortSignal): Promise<SearchResponse>;
}

const tavilyResponseSchema = z.object({ results: z.array(z.unknown()).default([]) });
const tavilyResultSchema = z.object({
  title: z.string().nullish().transform((t) => t ?? ""),
  // Only http(s): these URLs end up as links in the UI.
  url: z.url({ protocol: /^https?$/ }),
  content: z.string().nullish().transform((c) => c ?? ""),
});

export const TAVILY_BASE_URL = "https://api.tavily.com";

export const TAVILY_RETRY: RetryPolicy = { ...DEFAULT_RETRY, timeoutMs: 30_000 };

/** Tavily Search API (POST /search, bearer key). */
export class TavilyClient implements ResearchClient {
  readonly name = "tavily" as const;

  constructor(
    private readonly apiKey: string,
    private readonly http: HttpDeps = {},
    private readonly retry: RetryPolicy = TAVILY_RETRY,
    private readonly baseUrl: string = TAVILY_BASE_URL,
  ) {}

  static fromEnv(env: Record<string, string | undefined> = process.env): TavilyClient | null {
    return env.TAVILY_API_KEY ? new TavilyClient(env.TAVILY_API_KEY, {}, TAVILY_RETRY, env.TAVILY_BASE_URL || TAVILY_BASE_URL) : null;
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResponse> {
    const raw = await postJson(
      "tavily",
      `${this.baseUrl.replace(/\/+$/, "")}/search`,
      { query: query.slice(0, 400), max_results: 5, search_depth: "basic", include_answer: false },
      { authorization: `Bearer ${this.apiKey}` },
      this.retry,
      this.http,
      signal,
    );
    const r = tavilyResponseSchema.safeParse(raw);
    if (!r.success) throw new UpstreamError("tavily", `unexpected response shape: ${r.error.issues[0]?.message ?? "invalid"}`, null, false);
    const results: SearchResult[] = [];
    for (const item of r.data.results) {
      const one = tavilyResultSchema.safeParse(item);
      if (one.success) results.push(one.data);
    }
    return { results, dropped: r.data.results.length - results.length };
  }
}

/** Recorded search results for replay mode. */
export class ReplayResearch implements ResearchClient {
  readonly name = "replay" as const;
  constructor(private readonly byQuery: Record<string, SearchResult[]>) {}
  async search(query: string): Promise<SearchResponse> {
    const hit = this.byQuery[query];
    if (!hit) throw new ReplayMissError(`replay: no recorded search results for "${query}"`);
    return { results: hit, dropped: 0 };
  }
}

const EXTERNAL = /\b(leetcode|codeforces|atcoder|hackerrank|spoj|usaco|kattis|official|per the docs|documentation|rfc ?\d+|https?:\/\/)/i;

/** Research runs only when the statement leans on external facts, or when the user asks. */
export function needsResearch(statement: string, references: string[] | undefined, mode: "auto" | "force" | "off"): boolean {
  if (mode === "off") return false;
  if (mode === "force") return true;
  return (references?.length ?? 0) > 0 || EXTERNAL.test(statement);
}
