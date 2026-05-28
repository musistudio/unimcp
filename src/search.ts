import { z } from "zod";

import { DEFAULT_TIMEOUT_MS, compactRecord, env, envNumber } from "./config.js";

export const searchProviderSchema = z.enum([
  "auto",
  "brave",
  "bing",
  "google_cse",
  "serper",
  "serpapi",
  "tavily"
]);

export const webSearchInputSchema = z.object({
  prompt: z.string().min(1).describe("Natural-language search request or query."),
  count: z.number().int().min(1).max(20).optional().describe("Number of normalized results."),
  country: z.string().min(2).max(8).optional().describe("Country or market code, provider-dependent."),
  language: z.string().min(2).max(16).optional().describe("Language code, provider-dependent."),
  safeSearch: z.enum(["off", "moderate", "strict"]).optional(),
  freshness: z.enum(["day", "week", "month"]).optional(),
  timeoutMs: z.number().int().positive().max(180_000).optional(),
  includeDomains: z.array(z.string().min(1)).max(20).optional(),
  excludeDomains: z.array(z.string().min(1)).max(20).optional(),
  includeRaw: z.boolean().optional().describe("Include raw provider response in structuredContent.")
});

export type WebSearchInput = z.infer<typeof webSearchInputSchema>;
export type SearchProviderInput = z.infer<typeof searchProviderSchema>;
export type ConcreteSearchProvider = Exclude<SearchProviderInput, "auto">;

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  publishedAt?: string;
  score?: number;
}

export interface SearchResponse {
  provider: ConcreteSearchProvider;
  prompt: string;
  results: SearchResult[];
  raw?: unknown;
}

const providerOrder: ConcreteSearchProvider[] = [
  "brave",
  "bing",
  "google_cse",
  "serper",
  "serpapi",
  "tavily"
];

export async function webSearch(input: WebSearchInput): Promise<SearchResponse> {
  const provider = chooseProvider();

  switch (provider) {
    case "brave":
      return searchBrave(input, provider);
    case "bing":
      return searchBing(input, provider);
    case "google_cse":
      return searchGoogleCse(input, provider);
    case "serper":
      return searchSerper(input, provider);
    case "serpapi":
      return searchSerpApi(input, provider);
    case "tavily":
      return searchTavily(input, provider);
  }

  throw new Error(`Unsupported search provider: ${provider satisfies never}`);
}

export function formatSearchResults(response: SearchResponse): string {
  if (response.results.length === 0) {
    return `Provider: ${response.provider}\nPrompt: ${response.prompt}\n\nNo results.`;
  }

  const lines = [`Provider: ${response.provider}`, `Prompt: ${response.prompt}`, ""];
  response.results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title}`);
    lines.push(`   ${result.url}`);
    if (result.snippet) {
      lines.push(`   ${result.snippet}`);
    }
    const metadata = [
      result.source ? `source: ${result.source}` : undefined,
      result.publishedAt ? `published: ${result.publishedAt}` : undefined,
      typeof result.score === "number" ? `score: ${result.score}` : undefined
    ].filter(Boolean);
    if (metadata.length > 0) {
      lines.push(`   ${metadata.join(" | ")}`);
    }
  });

  return lines.join("\n");
}

function chooseProvider(): ConcreteSearchProvider {
  const configured = parseProvider(env("SEARCH_PROVIDER") ?? "auto");
  if (configured !== "auto") {
    return configured;
  }

  const provider = providerOrder.find(hasProviderConfig);
  if (!provider) {
    throw new Error(
      "No search provider configured. Set SEARCH_PROVIDER and its API key, such as BRAVE_SEARCH_API_KEY, BING_SEARCH_API_KEY, GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX, SERPER_API_KEY, SERPAPI_API_KEY, or TAVILY_API_KEY."
    );
  }

  return provider;
}

function parseProvider(value: string): SearchProviderInput {
  const parsed = searchProviderSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Unsupported search provider "${value}". Use one of: ${searchProviderSchema.options.join(", ")}.`
    );
  }

  return parsed.data;
}

function hasProviderConfig(provider: ConcreteSearchProvider): boolean {
  switch (provider) {
    case "brave":
      return Boolean(env("BRAVE_SEARCH_API_KEY"));
    case "bing":
      return Boolean(env("BING_SEARCH_API_KEY"));
    case "google_cse":
      return Boolean(env("GOOGLE_SEARCH_API_KEY") && env("GOOGLE_SEARCH_CX"));
    case "serper":
      return Boolean(env("SERPER_API_KEY"));
    case "serpapi":
      return Boolean(env("SERPAPI_API_KEY"));
    case "tavily":
      return Boolean(env("TAVILY_API_KEY"));
  }
}

async function searchBrave(input: WebSearchInput, provider: ConcreteSearchProvider): Promise<SearchResponse> {
  const apiKey = requireApiKey(provider, "BRAVE_SEARCH_API_KEY");
  const url = new URL(env("BRAVE_SEARCH_ENDPOINT") ?? "https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", queryWithDomainFilters(input));
  url.searchParams.set("count", String(resultCount(input)));
  if (input.country) url.searchParams.set("country", input.country.toUpperCase());
  if (input.language) url.searchParams.set("search_lang", input.language);
  if (input.safeSearch) url.searchParams.set("safesearch", input.safeSearch);
  if (input.freshness) url.searchParams.set("freshness", input.freshness);

  const raw = await fetchJson(url, {
    headers: {
      accept: "application/json",
      "X-Subscription-Token": apiKey
    }
  }, input);

  const web = readProperty(raw, "web");
  const items = readProperty(web, "results");
  const results = array(items).map((item) => ({
    title: stringValue(readProperty(item, "title"), "Untitled"),
    url: stringValue(readProperty(item, "url"), ""),
    snippet: optionalString(readProperty(item, "description")),
    publishedAt: optionalString(readProperty(item, "age")),
    source: optionalString(readProperty(readProperty(item, "profile"), "name"))
  })).filter(hasUrl);

  return withOptionalRaw({ provider, prompt: input.prompt, results }, raw, input.includeRaw);
}

async function searchBing(input: WebSearchInput, provider: ConcreteSearchProvider): Promise<SearchResponse> {
  const apiKey = requireApiKey(provider, "BING_SEARCH_API_KEY");
  const url = new URL(env("BING_SEARCH_ENDPOINT") ?? "https://api.bing.microsoft.com/v7.0/search");
  url.searchParams.set("q", queryWithDomainFilters(input));
  url.searchParams.set("count", String(resultCount(input)));
  if (input.country || input.language) url.searchParams.set("mkt", input.country ?? input.language ?? "en-US");
  if (input.safeSearch) url.searchParams.set("safeSearch", bingSafeSearch(input.safeSearch));
  if (input.freshness) url.searchParams.set("freshness", bingFreshness(input.freshness));

  const raw = await fetchJson(url, {
    headers: {
      accept: "application/json",
      "Ocp-Apim-Subscription-Key": apiKey
    }
  }, input);

  const webPages = readProperty(raw, "webPages");
  const items = readProperty(webPages, "value");
  const results = array(items).map((item) => ({
    title: stringValue(readProperty(item, "name"), "Untitled"),
    url: stringValue(readProperty(item, "url"), ""),
    snippet: optionalString(readProperty(item, "snippet")),
    publishedAt: optionalString(readProperty(item, "dateLastCrawled"))
  })).filter(hasUrl);

  return withOptionalRaw({ provider, prompt: input.prompt, results }, raw, input.includeRaw);
}

async function searchGoogleCse(input: WebSearchInput, provider: ConcreteSearchProvider): Promise<SearchResponse> {
  const apiKey = requireApiKey(provider, "GOOGLE_SEARCH_API_KEY");
  const engineId = env("GOOGLE_SEARCH_CX");
  if (!engineId) {
    throw new Error("Missing Google Programmable Search Engine id. Set GOOGLE_SEARCH_CX.");
  }

  const url = new URL(env("GOOGLE_SEARCH_ENDPOINT") ?? "https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", engineId);
  url.searchParams.set("q", queryWithDomainFilters(input));
  url.searchParams.set("num", String(Math.min(resultCount(input), 10)));
  if (input.language) url.searchParams.set("lr", `lang_${input.language}`);
  if (input.safeSearch) url.searchParams.set("safe", input.safeSearch === "off" ? "off" : "active");
  if (input.country) url.searchParams.set("gl", input.country);

  const raw = await fetchJson(url, { headers: { accept: "application/json" } }, input);
  const results = array(readProperty(raw, "items")).map((item) => ({
    title: stringValue(readProperty(item, "title"), "Untitled"),
    url: stringValue(readProperty(item, "link"), ""),
    snippet: optionalString(readProperty(item, "snippet")),
    source: optionalString(readProperty(item, "displayLink"))
  })).filter(hasUrl);

  return withOptionalRaw({ provider, prompt: input.prompt, results }, raw, input.includeRaw);
}

async function searchSerper(input: WebSearchInput, provider: ConcreteSearchProvider): Promise<SearchResponse> {
  const apiKey = requireApiKey(provider, "SERPER_API_KEY");
  const raw = await fetchJson(env("SERPER_SEARCH_ENDPOINT") ?? "https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-KEY": apiKey
    },
    body: JSON.stringify(compactRecord({
      q: queryWithDomainFilters(input),
      num: resultCount(input),
      gl: input.country,
      hl: input.language,
      tbs: freshnessToGoogleTbs(input.freshness)
    }))
  }, input);

  const results = array(readProperty(raw, "organic")).map((item) => ({
    title: stringValue(readProperty(item, "title"), "Untitled"),
    url: stringValue(readProperty(item, "link"), ""),
    snippet: optionalString(readProperty(item, "snippet")),
    source: optionalString(readProperty(item, "source")),
    publishedAt: optionalString(readProperty(item, "date"))
  })).filter(hasUrl);

  return withOptionalRaw({ provider, prompt: input.prompt, results }, raw, input.includeRaw);
}

async function searchSerpApi(input: WebSearchInput, provider: ConcreteSearchProvider): Promise<SearchResponse> {
  const apiKey = requireApiKey(provider, "SERPAPI_API_KEY");
  const url = new URL(env("SERPAPI_SEARCH_ENDPOINT") ?? "https://serpapi.com/search.json");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", queryWithDomainFilters(input));
  url.searchParams.set("num", String(resultCount(input)));
  if (input.country) url.searchParams.set("gl", input.country);
  if (input.language) url.searchParams.set("hl", input.language);
  if (input.safeSearch) url.searchParams.set("safe", input.safeSearch === "off" ? "off" : "active");
  if (input.freshness) url.searchParams.set("tbs", freshnessToGoogleTbs(input.freshness) ?? "");

  const raw = await fetchJson(url, { headers: { accept: "application/json" } }, input);
  const results = array(readProperty(raw, "organic_results")).map((item) => ({
    title: stringValue(readProperty(item, "title"), "Untitled"),
    url: stringValue(readProperty(item, "link"), ""),
    snippet: optionalString(readProperty(item, "snippet")),
    source: optionalString(readProperty(item, "source")),
    publishedAt: optionalString(readProperty(item, "date"))
  })).filter(hasUrl);

  return withOptionalRaw({ provider, prompt: input.prompt, results }, raw, input.includeRaw);
}

async function searchTavily(input: WebSearchInput, provider: ConcreteSearchProvider): Promise<SearchResponse> {
  const apiKey = requireApiKey(provider, "TAVILY_API_KEY");
  const raw = await fetchJson(env("TAVILY_SEARCH_ENDPOINT") ?? "https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(compactRecord({
      api_key: apiKey,
      query: input.prompt,
      max_results: resultCount(input),
      search_depth: "basic",
      include_domains: input.includeDomains,
      exclude_domains: input.excludeDomains,
      time_range: input.freshness
    }))
  }, input);

  const results = array(readProperty(raw, "results")).map((item) => ({
    title: stringValue(readProperty(item, "title"), "Untitled"),
    url: stringValue(readProperty(item, "url"), ""),
    snippet: optionalString(readProperty(item, "content")),
    publishedAt: optionalString(readProperty(item, "published_date")),
    score: numberValue(readProperty(item, "score"))
  })).filter(hasUrl);

  return withOptionalRaw({ provider, prompt: input.prompt, results }, raw, input.includeRaw);
}

function requireApiKey(provider: ConcreteSearchProvider, envName: string): string {
  const apiKey = env(envName);
  if (!apiKey) {
    throw new Error(`Missing API key for ${provider}. Set ${envName}.`);
  }

  return apiKey;
}

async function fetchJson(
  url: string | URL,
  init: RequestInit,
  input: WebSearchInput
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(input.timeoutMs ?? envNumber("SEARCH_TIMEOUT_MS", DEFAULT_TIMEOUT_MS))
  });
  const rawText = await response.text();
  const json = parseJson(rawText);

  if (!response.ok) {
    throw new Error(`Search request failed (${response.status}): ${extractProviderError(rawText, json)}`);
  }

  return json;
}

function resultCount(input: WebSearchInput): number {
  const value = input.count ?? envNumber("SEARCH_RESULT_COUNT", 5);
  return Math.max(1, Math.min(value, 20));
}

function queryWithDomainFilters(input: WebSearchInput): string {
  const include = input.includeDomains?.map((domain) => `site:${domain}`).join(" OR ");
  const exclude = input.excludeDomains?.map((domain) => `-site:${domain}`).join(" ");
  return [input.prompt, include ? `(${include})` : undefined, exclude].filter(Boolean).join(" ");
}

function bingSafeSearch(value: "off" | "moderate" | "strict"): string {
  return value === "off" ? "Off" : value === "strict" ? "Strict" : "Moderate";
}

function bingFreshness(value: "day" | "week" | "month"): string {
  return value === "day" ? "Day" : value === "week" ? "Week" : "Month";
}

function freshnessToGoogleTbs(value: "day" | "week" | "month" | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value === "day" ? "qdr:d" : value === "week" ? "qdr:w" : "qdr:m";
}

function withOptionalRaw(
  response: SearchResponse,
  raw: unknown,
  includeRaw: boolean | undefined
): SearchResponse {
  return includeRaw ? { ...response, raw } : response;
}

function hasUrl(result: SearchResult): boolean {
  return Boolean(result.url);
}

function parseJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`Invalid JSON from search provider: ${rawText.slice(0, 500)}`);
  }
}

function extractProviderError(rawText: string, json: unknown): string {
  const message =
    optionalString(readProperty(json, "message")) ??
    optionalString(readProperty(json, "error")) ??
    optionalString(readProperty(readProperty(json, "error"), "message"));

  return message ?? rawText.slice(0, 500);
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringValue(value: unknown, fallback: string): string {
  return optionalString(value) ?? fallback;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}
