export type SearchResult = { title: string; url: string; content: string };
export type ResearchFact = { fact: string; url: string };

export interface ResearchClient {
  readonly name: "tavily" | "replay";
  search(query: string): Promise<SearchResult[]>;
}

/** Tavily Search API. */
export class TavilyClient implements ResearchClient {
  readonly name = "tavily" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  static fromEnv(env: Record<string, string | undefined> = process.env): TavilyClient | null {
    return env.TAVILY_API_KEY ? new TavilyClient(env.TAVILY_API_KEY) : null;
  }

  async search(query: string): Promise<SearchResult[]> {
    const res = await this.fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ query, max_results: 5, search_depth: "basic", include_answer: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    const j = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    return (j.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", content: r.content ?? "" }));
  }
}

/** Recorded search results for replay mode. */
export class ReplayResearch implements ResearchClient {
  readonly name = "replay" as const;
  constructor(private readonly byQuery: Record<string, SearchResult[]>) {}
  async search(query: string): Promise<SearchResult[]> {
    const hit = this.byQuery[query];
    if (!hit) throw new Error(`replay: no recorded search results for "${query}"`);
    return hit;
  }
}

const EXTERNAL = /\b(leetcode|codeforces|atcoder|hackerrank|spoj|usaco|kattis|official|per the docs|documentation|rfc ?\d+|https?:\/\/)/i;

/** Research runs only when the statement leans on external facts, or when the user asks. */
export function needsResearch(statement: string, references: string[] | undefined, mode: "auto" | "force" | "off"): boolean {
  if (mode === "off") return false;
  if (mode === "force") return true;
  return (references?.length ?? 0) > 0 || EXTERNAL.test(statement);
}
