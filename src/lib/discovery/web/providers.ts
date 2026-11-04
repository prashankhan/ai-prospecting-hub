import { requestJSON, type FetchLike } from "@/lib/ai/http";
import { ProviderError } from "@/lib/ai/types";
import type { WebQueryPlan, WebSearchResult } from "./candidates";

export const WEB_SEARCH_PROVIDER_IDS = ["serper", "brave", "gemini_search"] as const;
export type WebSearchProviderId = (typeof WEB_SEARCH_PROVIDER_IDS)[number];

export interface WebSearchCredentials {
  apiKey: string;
  /** Gemini model, only for gemini_search. */
  model?: string;
}

export interface WebSearchAdapter {
  id: WebSearchProviderId;
  /** Whether a second results page exists for the same query. */
  supportsPaging: boolean;
  testConnection(cred: WebSearchCredentials): Promise<{ ok: true; message: string }>;
  search(cred: WebSearchCredentials, plan: WebQueryPlan, opts: { page: number; countryCode?: string | null }): Promise<WebSearchResult[]>;
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------- Serper (Google results)
interface SerperResponse {
  organic?: { title?: string; link?: string; snippet?: string }[];
}

export function createSerperAdapter(fetchImpl: FetchLike = fetch): WebSearchAdapter {
  const call = (apiKey: string, body: Record<string, unknown>) =>
    requestJSON<SerperResponse>("serper", "https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 20_000,
    }, fetchImpl);
  return {
    id: "serper",
    supportsPaging: true,
    async testConnection({ apiKey }) {
      await call(apiKey, { q: "coffee shop", num: 10 });
      return { ok: true, message: "Connected to Serper (used 1 search credit)." };
    },
    async search({ apiKey }, plan, { page, countryCode }) {
      const data = await call(apiKey, { q: plan.query, num: 10, page: page + 1, ...(countryCode ? { gl: countryCode.toLowerCase() } : {}) });
      return (data.organic ?? [])
        .filter((r) => r.link && r.title)
        .map((r) => ({ title: stripTags(r.title!), url: r.link!, snippet: stripTags(r.snippet ?? "") }));
    },
  };
}

// ---------------------------------------------------------------------------- Brave Search API
interface BraveResponse {
  web?: { results?: { title?: string; url?: string; description?: string }[] };
}

export function createBraveAdapter(fetchImpl: FetchLike = fetch): WebSearchAdapter {
  const call = (apiKey: string, params: Record<string, string>) =>
    requestJSON<BraveResponse>("brave", `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams(params)}`, {
      method: "GET",
      headers: { "X-Subscription-Token": apiKey, accept: "application/json" },
      timeoutMs: 20_000,
    }, fetchImpl);
  return {
    id: "brave",
    supportsPaging: true,
    async testConnection({ apiKey }) {
      await call(apiKey, { q: "coffee shop", count: "1" });
      return { ok: true, message: "Connected to Brave Search (used 1 request)." };
    },
    async search({ apiKey }, plan, { page, countryCode }) {
      const params: Record<string, string> = { q: plan.query, count: "20", offset: String(Math.min(page, 9)) };
      if (countryCode) params.country = countryCode.toLowerCase() === "gb" ? "gb" : countryCode.toLowerCase();
      const data = await call(apiKey, params);
      return (data.web?.results ?? [])
        .filter((r) => r.url && r.title)
        .map((r) => ({ title: stripTags(r.title!), url: r.url!, snippet: stripTags(r.description ?? "") }));
    },
  };
}

// ---------------------------------------------------------------------------- Gemini grounding with Google Search
interface GroundedResponse {
  candidates?: {
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[]; webSearchQueries?: string[] };
  }[];
  promptFeedback?: { blockReason?: string };
}

const GROUNDING_REDIRECT = /^https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\//;

/** Resolves a grounding redirect link to the real page URL without downloading the page. */
async function resolveRedirect(uri: string, fetchImpl: FetchLike): Promise<string | null> {
  if (!GROUNDING_REDIRECT.test(uri)) return uri;
  try {
    const res = await fetchImpl(uri, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8_000) });
    await res.body?.cancel();
    const loc = res.headers.get("location");
    return loc && /^https?:\/\//i.test(loc) ? loc : null;
  } catch {
    return null;
  }
}

/**
 * Uses the configured Gemini key with the Google Search tool. Only the URLs Google actually
 * returned as grounding sources are used — the model's own text is ignored, so it cannot
 * introduce businesses or accounts that search did not return.
 */
export function createGeminiSearchAdapter(fetchImpl: FetchLike = fetch): WebSearchAdapter {
  const call = async (apiKey: string, model: string, prompt: string) => {
    const data = await requestJSON<GroundedResponse>(
      "gemini_search",
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        }),
        timeoutMs: 45_000,
      },
      fetchImpl,
    );
    if (data.promptFeedback?.blockReason) throw new ProviderError("gemini_search", "safety_block", data.promptFeedback.blockReason);
    return data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  };
  return {
    id: "gemini_search",
    supportsPaging: false,
    async testConnection({ apiKey, model }) {
      if (!model) throw new ProviderError("gemini_search", "not_configured", "Select a Gemini model in Settings → AI providers first.");
      const chunks = await call(apiKey, model, "Search the web for the official website of the Eiffel Tower.");
      if (chunks.length === 0) {
        throw new ProviderError("gemini_search", "invalid_response", "The model answered without Google Search sources. Choose a model that supports Grounding with Google Search.");
      }
      return { ok: true, message: `Connected. Google Search grounding returned ${chunks.length} source(s).` };
    },
    async search({ apiKey, model }, plan) {
      if (!model) throw new ProviderError("gemini_search", "not_configured", "Select a Gemini model in Settings → AI providers first.");
      const prompt = plan.kind === "instagram"
        ? `Use Google Search to find Instagram profiles for: ${plan.query.replace(/^site:instagram\.com\s*/i, "")}. Search for individual businesses' own Instagram accounts and their official websites. Find as many distinct businesses as possible.`
        : `Use Google Search to find individual businesses matching: ${plan.query}. Look for each business's own official website (not directories, review sites or lists). Find as many distinct businesses as possible.`;
      const chunks = await call(apiKey, model, prompt);
      const out: WebSearchResult[] = [];
      for (const c of chunks.slice(0, 20)) {
        if (!c.web?.uri) continue;
        const url = await resolveRedirect(c.web.uri, fetchImpl);
        if (url) out.push({ title: c.web.title ?? "", url, snippet: "" });
      }
      return out;
    },
  };
}

export function getWebSearchAdapter(id: WebSearchProviderId, fetchImpl: FetchLike = fetch): WebSearchAdapter {
  switch (id) {
    case "serper":
      return createSerperAdapter(fetchImpl);
    case "brave":
      return createBraveAdapter(fetchImpl);
    case "gemini_search":
      return createGeminiSearchAdapter(fetchImpl);
  }
}
