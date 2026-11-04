import { describe, expect, it } from "vitest";
import { buildTextQuery, createGooglePlacesAdapter } from "@/lib/discovery/providers/google-places";
import { exclusionMatch } from "@/lib/discovery/types";

describe("google places adapter", () => {
  it("builds a text query from structured criteria", () => {
    expect(buildTextQuery({ keywords: "tattoo studio", industry: "Tattoo studios", city: "Austin", country: "United States", exclusions: [] }))
      .toBe("tattoo studio Tattoo studios in Austin United States");
    expect(buildTextQuery({ keywords: "tattoo studio", industry: "tattoo", exclusions: [] })).toBe("tattoo studio");
  });

  it("maps places, skips closed businesses and applies exclusions", async () => {
    let sentHeaders: Record<string, string> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sentHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify({
        places: [
          { id: "p1", displayName: { text: "Ink House" }, websiteUri: "https://inkhouse.com", internationalPhoneNumber: "+1 512-555-0100", businessStatus: "OPERATIONAL",
            addressComponents: [{ longText: "Austin", types: ["locality"] }, { shortText: "US", types: ["country"] }], primaryTypeDisplayName: { text: "Tattoo shop" } },
          { id: "p2", displayName: { text: "Old Studio" }, businessStatus: "CLOSED_PERMANENTLY" },
          { id: "p3", displayName: { text: "Laser Tattoo Removal Center" }, businessStatus: "OPERATIONAL" },
        ],
        nextPageToken: "next",
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const page = await createGooglePlacesAdapter(fetchImpl).searchPage("key", { keywords: "tattoo", exclusions: ["removal"] }, { pageSize: 20 });
    expect(sentHeaders["X-Goog-Api-Key"]).toBe("key");
    expect(page.candidates).toHaveLength(1);
    expect(page.candidates[0]).toMatchObject({ business_name: "Ink House", place_id: "p1", city: "Austin", country: "US", category: "Tattoo shop" });
    expect(page.excluded.map((e) => e.name)).toEqual(["Old Studio", "Laser Tattoo Removal Center"]);
    expect(page.nextPageToken).toBe("next");
  });

  it("surfaces provider auth errors", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 })) as unknown as typeof fetch;
    await expect(createGooglePlacesAdapter(fetchImpl).testConnection("bad")).rejects.toMatchObject({ code: "auth" });
  });

  it("matches exclusions case-insensitively", () => {
    expect(exclusionMatch({ business_name: "Supply Co", category: null }, ["SUPPLY"])).toBe("supply");
    expect(exclusionMatch({ business_name: "Ink House" }, ["supply"])).toBeNull();
  });
});
