import { describe, expect, it } from "vitest";
import { buildCandidate, classifyInstagram, mergeEvidence, type InstagramEvidence } from "@/lib/identity/candidate";

const ev = (username: string, source: InstagramEvidence["source"]): InstagramEvidence => ({
  username, source, observed_at: "2026-01-01T00:00:00.000Z",
});

describe("classifyInstagram", () => {
  it("never invents a username", () => {
    expect(classifyInstagram([], false)).toEqual({ status: "unknown", username: null });
    expect(classifyInstagram([], true)).toEqual({ status: "not_found", username: null });
  });
  it("verifies only with website or manual evidence", () => {
    expect(classifyInstagram([ev("ink", "csv")], true).status).toBe("likely");
    expect(classifyInstagram([ev("ink", "provider")], true).status).toBe("likely");
    expect(classifyInstagram([ev("ink", "csv"), ev("ink", "business_website")], true)).toEqual({ status: "verified", username: "ink" });
  });
  it("flags conflicts and lets a manual check resolve them", () => {
    expect(classifyInstagram([ev("ink", "csv"), ev("ink2", "business_website")], true)).toEqual({ status: "conflicting", username: null });
    expect(classifyInstagram([ev("ink", "csv"), ev("ink2", "business_website"), ev("ink2", "manual")], true)).toEqual({
      status: "verified", username: "ink2",
    });
  });
  it("merges evidence without duplicates", () => {
    expect(mergeEvidence([ev("a", "csv")], [ev("a", "csv"), ev("a", "manual")])).toHaveLength(2);
  });
});

describe("buildCandidate", () => {
  it("derives identity keys and preserves the original record", () => {
    const raw = {
      business_name: "Ink House Tattoo LLC",
      country: "USA",
      city: "Austin",
      website: "https://www.inkhouse.com/?utm_source=maps",
      phone: "(512) 555-0100",
      instagram: "https://instagram.com/InkHouseATX",
      place_id: "ChIJ123",
      source: "google_places",
    };
    const c = buildCandidate(raw);
    expect(c.normalized_name).toBe("ink house tattoo");
    expect(c.country_code).toBe("US");
    expect(c.country).toBe("United States");
    expect(c.website).toBe("https://www.inkhouse.com");
    expect(c.instagram_username).toBe("inkhouseatx");
    expect(c.instagram_match_status).toBe("likely");
    expect(c.keys).toEqual([
      { type: "place_id", value: "ChIJ123" },
      { type: "instagram_username", value: "inkhouseatx" },
      { type: "domain", value: "inkhouse.com" },
      { type: "phone", value: "+15125550100" },
    ]);
    expect(c.source_data.original).toEqual(raw);
  });
  it("treats an Instagram URL in the website column as Instagram, not a website", () => {
    const c = buildCandidate({ business_name: "IG Only", website: "instagram.com/igonly", source: "csv" });
    expect(c.website).toBeNull();
    expect(c.instagram_username).toBe("igonly");
    expect(c.keys).toEqual([{ type: "instagram_username", value: "igonly" }]);
  });
  it("rejects records without a business name", () => {
    expect(() => buildCandidate({ business_name: "  ", source: "csv" })).toThrow();
  });
});
