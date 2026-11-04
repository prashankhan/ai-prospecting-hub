import type { RawCandidate } from "@/lib/identity/candidate";

/** Structured place-search providers (return business records). */
export const PLACES_PROVIDER_IDS = ["google_places"] as const;
export type DiscoveryProviderId = (typeof PLACES_PROVIDER_IDS)[number];

/** Every configurable discovery provider: place search plus web search (see lib/discovery/web). */
export const DISCOVERY_PROVIDER_IDS = ["google_places", "serper", "brave", "gemini_search"] as const;
export type AnyDiscoveryProviderId = (typeof DISCOVERY_PROVIDER_IDS)[number];

export interface DiscoveryQuery {
  keywords: string;
  industry?: string;
  country?: string;
  city?: string;
  exclusions: string[];
}

export interface DiscoveryPage {
  candidates: RawCandidate[];
  excluded: { name: string; reason: string }[];
  nextPageToken: string | null;
}

export interface DiscoveryAdapter {
  id: DiscoveryProviderId;
  testConnection(apiKey: string): Promise<{ ok: true; message: string }>;
  searchPage(apiKey: string, query: DiscoveryQuery, opts: { pageToken?: string | null; pageSize: number }): Promise<DiscoveryPage>;
}

export interface DiscoveryProviderInfo {
  id: string;
  label: string;
  description: string;
  availability: "available" | "planned";
  /** "web" providers drive the agent workflow that finds websites and verified Instagram profiles. */
  mode?: "web" | "places" | "import";
  /** gemini_search reuses the Gemini AI key instead of its own credential. */
  usesGeminiKey?: boolean;
  keyHelpUrl?: string;
  keyPlaceholder?: string;
  recommended?: boolean;
  notes: string[];
}

export const DISCOVERY_PROVIDERS: DiscoveryProviderInfo[] = [
  {
    id: "gemini_search",
    label: "Gemini · Google Search grounding",
    description: "Finds businesses with Google Search through your existing Gemini key. No extra account or key needed.",
    availability: "available",
    mode: "web",
    usesGeminiKey: true,
    recommended: true,
    notes: [
      "Only URLs Google returns as search sources are used; the model's own text is ignored, so it can't introduce businesses or accounts.",
      "Google bills grounded searches per search query on Gemini 3+ models after a monthly free allowance (5,000 per month at the time of writing). Each discovery query is one or more grounded searches.",
    ],
  },
  {
    id: "serper",
    label: "Serper (Google Search API)",
    description: "Google web results as JSON. Usually the most results per query for finding business websites and Instagram profiles.",
    availability: "available",
    mode: "web",
    keyHelpUrl: "https://serper.dev/api-key",
    keyPlaceholder: "Serper API key",
    notes: ["2,500 free queries on sign-up, then low-cost paid credits. Each search page (10 results) uses one credit."],
  },
  {
    id: "brave",
    label: "Brave Search API",
    description: "Independent web index with up to 20 results per request.",
    availability: "available",
    mode: "web",
    keyHelpUrl: "https://api-dashboard.search.brave.com/app/keys",
    keyPlaceholder: "Brave subscription token",
    notes: ["Check Brave's current plans for free monthly credits. Each search page is one request."],
  },
  {
    id: "google_places",
    label: "Google Places API (New)",
    description: "Text Search for businesses by keyword and location. Returns name, address, website, phone and place ID.",
    availability: "available",
    mode: "places",
    keyHelpUrl: "https://developers.google.com/maps/documentation/places/web-service/get-api-key",
    keyPlaceholder: "AIza…",
    notes: [
      "Requires a Google Maps Platform key with “Places API (New)” enabled and billing configured. Each page of up to 20 results is one billable Text Search request.",
      "Google Maps Platform terms restrict long-term caching of Places content. Place IDs may be stored indefinitely; review the terms for your use case. Prospects sourced from Places are attributed to Google Maps.",
    ],
  },
  {
    id: "csv",
    label: "CSV import",
    description: "Import businesses you have legitimately collected. Always available.",
    availability: "available",
    mode: "import",
    notes: ["Up to 1,000 rows and 2 MB per file. Imports run through the same duplicate checks as discovery."],
  },
  {
    id: "outscraper",
    label: "Outscraper",
    description: "Bulk Google Maps data with enrichment.",
    availability: "planned",
    notes: ["Planned for V2. Not selectable yet."],
  },
];

/** Applies the project/search exclusion terms to a candidate (case-insensitive). */
export function exclusionMatch(c: { business_name: string; category?: string | null; website?: string | null }, exclusions: string[]): string | null {
  const hay = `${c.business_name} ${c.category ?? ""} ${c.website ?? ""}`.toLowerCase();
  for (const term of exclusions) {
    const t = term.trim().toLowerCase();
    if (t && hay.includes(t)) return t;
  }
  return null;
}
