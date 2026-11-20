import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError, toolOk } from "../contracts/tool.js";

export const WebSearchInput = z.object({
  query: z.string().min(1),
  allowed_domains: z.array(z.string()).optional(),
  blocked_domains: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(20).optional(),
});

export type WebSearchInputType = z.infer<typeof WebSearchInput>;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  name: string;
  search(query: string, options: { limit: number; signal: AbortSignal }): Promise<SearchResult[]>;
}

export interface WebSearchOptions {
  provider: SearchProvider | null;
}

function hostMatches(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const expected = domain.toLowerCase();
    return host === expected || host.endsWith(`.${expected}`);
  } catch {
    return false;
  }
}

export function formatResults(results: SearchResult[]): string {
  return results
    .map((result, index) => `[${index + 1}] ${result.title}\n${result.url}\n${result.snippet}`)
    .join("\n\n");
}

export function createWebSearchTool(options: WebSearchOptions): Tool<WebSearchInputType> {
  return {
    name: "WebSearch",
    description:
      "Search the web with a configured provider and return cited results. Supports allowed and blocked domain filters.",
    input: WebSearchInput,
    readOnly: true,
    concurrency: "parallel",
    async execute(input: WebSearchInputType, ctx: ToolContext): Promise<ToolResult> {
      if (!options.provider) {
        return toolError(
          "WebSearch is disabled. Configure a search provider (Brave, Tavily, SearXNG, or Google CSE) in settings.",
          { code: "TOOL_UNSUPPORTED" },
        );
      }
      let results: SearchResult[];
      try {
        results = await options.provider.search(input.query, {
          limit: input.limit ?? 5,
          signal: ctx.signal,
        });
      } catch (error) {
        return toolError(`Search failed: ${(error as Error).message}`, { code: "PROVIDER_UNAVAILABLE" });
      }
      const allowed = input.allowed_domains ?? [];
      const blocked = input.blocked_domains ?? [];
      const filtered = results.filter((result) => {
        if (allowed.length > 0 && !allowed.some((domain) => hostMatches(result.url, domain))) return false;
        if (blocked.some((domain) => hostMatches(result.url, domain))) return false;
        return true;
      });
      if (filtered.length === 0) return toolOk("No results found.", { count: 0 });
      return toolOk(formatResults(filtered), { count: filtered.length, provider: options.provider.name });
    },
  };
}

export interface SearchProviderConfig {
  kind: "brave" | "tavily" | "searxng" | "google";
  endpoint?: string | undefined;
  apiKey?: string | undefined;
  cx?: string | undefined;
}

export function createConfiguredSearchProvider(
  config: SearchProviderConfig | null | undefined,
  fetchImpl: typeof fetch = fetch,
): SearchProvider | null {
  if (!config) return null;
  const kind = config.kind;
  const endpoint =
    config.endpoint ??
    (kind === "brave"
      ? "https://api.search.brave.com/res/v1/web/search"
      : kind === "tavily"
        ? "https://api.tavily.com/search"
        : kind === "google"
          ? "https://www.googleapis.com/customsearch/v1"
          : "");
  if (endpoint.length === 0) return null;

  return {
    name: kind,
    async search(query, options) {
      const url = new URL(endpoint);
      const headers: Record<string, string> = { accept: "application/json" };
      if (kind === "brave") {
        url.searchParams.set("q", query);
        url.searchParams.set("count", String(options.limit));
        if (config.apiKey) headers["x-subscription-token"] = config.apiKey;
      } else if (kind === "google") {
        url.searchParams.set("q", query);
        url.searchParams.set("num", String(options.limit));
        if (config.apiKey) url.searchParams.set("key", config.apiKey);
        if (config.cx) url.searchParams.set("cx", config.cx);
      } else if (kind === "searxng") {
        url.searchParams.set("q", query);
        url.searchParams.set("format", "json");
      }
      const response = await fetchImpl(url, {
        method: kind === "tavily" ? "POST" : "GET",
        headers: { ...headers, "content-type": "application/json" },
        signal: options.signal,
        ...(kind === "tavily"
          ? { body: JSON.stringify({ api_key: config.apiKey, query, max_results: options.limit }) }
          : {}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as Record<string, unknown>;
      if (kind === "brave") {
        const web = body.web as { results?: Array<{ title?: string; url?: string; description?: string }> } | undefined;
        return (web?.results ?? []).map((result) => ({
          title: result.title ?? result.url ?? "",
          url: result.url ?? "",
          snippet: result.description ?? "",
        }));
      }
      if (kind === "google") {
        const items = (body.items as Array<{ title?: string; link?: string; snippet?: string }> | undefined) ?? [];
        return items.map((item) => ({ title: item.title ?? "", url: item.link ?? "", snippet: item.snippet ?? "" }));
      }
      const raw = (body.results as Array<{ title?: string; url?: string; content?: string; snippet?: string }> | undefined) ?? [];
      return raw.map((result) => ({
        title: result.title ?? "",
        url: result.url ?? "",
        snippet: result.content ?? result.snippet ?? "",
      }));
    },
  };
}
