import type { RawCandidate } from "@/lib/identity/candidate";

export const DISCOVERY_PROVIDER_IDS = ["google_places"] as const;
export type DiscoveryProviderId = (typeof DISCOVERY_PROVIDER_IDS)[number];

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
  keyHelpUrl?: string;
  notes: string[];
}

export const DISCOVERY_PROVIDERS: DiscoveryProviderInfo[] = [
  {
    id: "google_places",
    label: "Google Places API (New)",
    description: "Text Search for businesses by keyword and location. Returns name, address, website, phone and place ID.",
    availability: "available",
    keyHelpUrl: "https://developers.google.com/maps/documentation/places/web-service/get-api-key",
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
