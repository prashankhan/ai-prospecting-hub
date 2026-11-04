import { requestJSON, type FetchLike } from "@/lib/ai/http";
import { ProviderError } from "@/lib/ai/types";
import { exclusionMatch, type DiscoveryAdapter, type DiscoveryQuery } from "../types";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.addressComponents", "places.websiteUri",
  "places.nationalPhoneNumber", "places.internationalPhoneNumber", "places.primaryTypeDisplayName", "places.types",
  "places.businessStatus", "places.googleMapsUri", "nextPageToken",
].join(",");

interface AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}
interface Place {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: AddressComponent[];
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  businessStatus?: string;
  googleMapsUri?: string;
}
interface SearchResponse {
  places?: Place[];
  nextPageToken?: string;
}

export function buildTextQuery(q: DiscoveryQuery): string {
  return [q.keywords, q.industry && !q.keywords.toLowerCase().includes(q.industry.toLowerCase()) ? q.industry : "", q.city ? `in ${q.city}` : "", q.country ?? ""]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

function component(place: Place, type: string, short = false) {
  const c = place.addressComponents?.find((a) => a.types?.includes(type));
  return (short ? c?.shortText : c?.longText) ?? null;
}

export function createGooglePlacesAdapter(fetchImpl: FetchLike = fetch): DiscoveryAdapter {
  return {
    id: "google_places",

    async testConnection(apiKey) {
      // IDs-only field mask keeps the verification request in the lowest-cost tier.
      await requestJSON("google_places", ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.id" },
        body: JSON.stringify({ textQuery: "coffee shop in London", pageSize: 1 }),
        timeoutMs: 15_000,
      }, fetchImpl);
      return { ok: true, message: "Connected to Places API (New)." };
    },

    async searchPage(apiKey, query, { pageToken, pageSize }) {
      const textQuery = buildTextQuery(query);
      if (!textQuery) throw new ProviderError("google_places", "bad_request", "Search query is empty");
      const data = await requestJSON<SearchResponse>("google_places", ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELDS },
        body: JSON.stringify({ textQuery, pageSize: Math.min(Math.max(pageSize, 1), 20), ...(pageToken ? { pageToken } : {}) }),
        timeoutMs: 20_000,
      }, fetchImpl);

      const excluded: { name: string; reason: string }[] = [];
      const candidates = [];
      for (const place of data.places ?? []) {
        const name = place.displayName?.text?.trim();
        if (!name) continue;
        if (place.businessStatus && place.businessStatus !== "OPERATIONAL") {
          excluded.push({ name, reason: `Business status: ${place.businessStatus.toLowerCase().replace(/_/g, " ")}` });
          continue;
        }
        const raw = {
          business_name: name,
          category: place.primaryTypeDisplayName?.text ?? null,
          country: component(place, "country", true) ?? query.country ?? null,
          city: component(place, "locality") ?? component(place, "postal_town") ?? component(place, "administrative_area_level_2") ?? null,
          address: place.formattedAddress ?? null,
          website: place.websiteUri ?? null,
          phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
          place_id: place.id,
          source: "google_places",
          source_ref: place.id,
          source_data: {
            provider: "google_places",
            attribution: "Google Maps",
            google_maps_uri: place.googleMapsUri ?? null,
            types: place.types ?? [],
            business_status: place.businessStatus ?? null,
            query: textQuery,
          },
        };
        const hit = exclusionMatch(raw, query.exclusions);
        if (hit) {
          excluded.push({ name, reason: `Matches exclusion “${hit}”` });
          continue;
        }
        candidates.push(raw);
      }
      return { candidates, excluded, nextPageToken: data.nextPageToken ?? null };
    },
  };
}
