import { describe, expect, it } from "vitest";
import {
  appearsIn, classifyResults, handleFromInstagramTitle, instagramOutcome, planQueries, websitesInText,
} from "@/lib/discovery/web/candidates";
import { getWebSearchAdapter } from "@/lib/discovery/web/providers";

describe("query planning", () => {
  it("mixes website and Instagram queries for a location, without duplicates", () => {
    const plan = planQueries({ keywords: "tattoo studio", industry: "Tattoo studios", city: "Austin", country: "United States" });
    expect(plan[0]).toEqual({ query: "tattoo studio Tattoo studios Austin, United States", kind: "web" });
    expect(plan.some((p) => p.kind === "instagram" && p.query.startsWith("site:instagram.com"))).toBe(true);
    expect(new Set(plan.map((p) => p.query)).size).toBe(plan.length);
  });
});

describe("search result classification", () => {
  const results = [
    { title: "Ink House Tattoo — Austin", url: "https://www.inkhouse.com/about?utm_source=x", snippet: "Custom tattoos in Austin" },
    { title: "THE 10 BEST Tattoo Shops in Austin", url: "https://www.yelp.com/search?find_desc=tattoo", snippet: "" },
    { title: "15 Best Tattoo Studios in Austin (2026)", url: "https://somebloglist.com/austin-tattoo", snippet: "" },
    { title: "Needle & Thread (@needlethreadatx) • Instagram photos and videos", url: "https://www.instagram.com/needlethreadatx/", snippet: "Tattoo studio · Book at needlethread.com" },
    { title: "Solo Artist (@soloartist) • Instagram", url: "https://instagram.com/soloartist", snippet: "DM to book" },
    { title: "post", url: "https://www.instagram.com/p/Cx123/", snippet: "" },
    { title: "Ink House Tattoo", url: "https://inkhouse.com/", snippet: "duplicate domain" },
    { title: "Linktree", url: "https://linktr.ee/someone", snippet: "" },
  ];
  const { websites, instagram, dropped } = classifyResults(results);

  it("keeps business websites once per domain and drops directories and listicles", () => {
    expect(websites.map((w) => w.domain).sort()).toEqual(["inkhouse.com", "needlethread.com"]);
    expect(dropped.map((d) => d.reason)).toEqual(expect.arrayContaining(["Directory or social site", "Listicle or index page", "Instagram post or non-profile page", "Shared or non-business host"]));
  });
  it("turns an Instagram result with a link-in-bio domain into a website to verify", () => {
    const w = websites.find((x) => x.domain === "needlethread.com")!;
    expect(w.hintedInstagram).toBe("needlethreadatx");
    expect(w.website).toBe("https://needlethread.com");
  });
  it("keeps Instagram-only results as unverified candidates", () => {
    expect(instagram).toEqual([expect.objectContaining({ username: "soloartist" })]);
  });
  it("parses handles and domains from text", () => {
    expect(handleFromInstagramTitle("Ink House (@InkHouse.ATX) • Instagram")).toBe("inkhouse.atx");
    expect(websitesInText("Book online: inkhouse.co.uk or yelp.com")).toEqual(["inkhouse.co.uk"]);
  });
});

describe("Instagram verification outcome", () => {
  it("verifies only a single profile linked by the business website", () => {
    expect(instagramOutcome(["inkhouse"], null)).toEqual({ status: "verified", username: "inkhouse" });
    expect(instagramOutcome(["inkhouse"], "otherhandle")).toEqual({ status: "verified", username: "inkhouse" });
  });
  it("never verifies a search hint the website does not confirm", () => {
    expect(instagramOutcome([], "inkhouse")).toEqual({ status: "not_found", username: null });
    expect(instagramOutcome(["artist1", "inkhouse"], "inkhouse")).toEqual({ status: "likely", username: "inkhouse" });
    expect(instagramOutcome(["artist1", "artist2"], null)).toEqual({ status: "conflicting", username: null });
  });
  it("only accepts AI-extracted values that appear in the sources", () => {
    expect(appearsIn("Ink House", "Welcome to INK HOUSE tattoo, Austin")).toBe(true);
    expect(appearsIn("Ink Palace", "Welcome to Ink House tattoo")).toBe(false);
    expect(appearsIn(null, "anything")).toBe(false);
  });
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return (async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init)) as typeof fetch;
}

describe("web search adapters", () => {
  it("serper sends the key header and maps organic results", async () => {
    let headers: Record<string, string> = {};
    let body: Record<string, unknown> = {};
    const a = getWebSearchAdapter("serper", mockFetch((_u, init) => {
      headers = init!.headers as Record<string, string>;
      body = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ organic: [{ title: "Ink <b>House</b>", link: "https://inkhouse.com", snippet: "Austin" }] }));
    }));
    const r = await a.search({ apiKey: "k" }, { query: "tattoo Austin", kind: "web" }, { page: 1, countryCode: "US" });
    expect(headers["X-API-KEY"]).toBe("k");
    expect(body).toMatchObject({ q: "tattoo Austin", page: 2, gl: "us" });
    expect(r).toEqual([{ title: "Ink House", url: "https://inkhouse.com", snippet: "Austin" }]);
  });

  it("brave maps web results and reports auth errors", async () => {
    const ok = getWebSearchAdapter("brave", mockFetch((u) => {
      expect(u).toContain("q=tattoo");
      return new Response(JSON.stringify({ web: { results: [{ title: "Ink", url: "https://ink.com", description: "<strong>Austin</strong> studio" }] } }));
    }));
    expect(await ok.search({ apiKey: "k" }, { query: "tattoo", kind: "web" }, { page: 0 })).toEqual([{ title: "Ink", url: "https://ink.com", snippet: "Austin studio" }]);
    const bad = getWebSearchAdapter("brave", mockFetch(() => new Response("{}", { status: 401 })));
    await expect(bad.testConnection({ apiKey: "x" })).rejects.toMatchObject({ code: "auth" });
  });

  it("gemini search uses only grounding sources, resolving redirects, and ignores model text", async () => {
    let sentBody: Record<string, unknown> = {};
    const a = getWebSearchAdapter("gemini_search", mockFetch((u, init) => {
      if (u.includes("generateContent")) {
        sentBody = JSON.parse(String(init!.body));
        return new Response(JSON.stringify({
          candidates: [{
            content: { parts: [{ text: "Here are studios: Fake Ink (@fakeink) at fakeink.com" }] },
            groundingMetadata: { groundingChunks: [
              { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "inkhouse.com" } },
              { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/def", title: "instagram.com" } },
            ] },
          }],
        }));
      }
      if (u.endsWith("/abc")) return new Response(null, { status: 302, headers: { location: "https://www.inkhouse.com/" } });
      if (u.endsWith("/def")) return new Response(null, { status: 302, headers: { location: "https://www.instagram.com/inkhouse/" } });
      throw new Error(`unexpected ${u}`);
    }));
    const r = await a.search({ apiKey: "k", model: "gemini-x" }, { query: "tattoo Austin", kind: "web" }, { page: 0 });
    expect(sentBody.tools).toEqual([{ google_search: {} }]);
    expect(r.map((x) => x.url)).toEqual(["https://www.inkhouse.com/", "https://www.instagram.com/inkhouse/"]);
    expect(JSON.stringify(r)).not.toContain("fakeink");
  });

  it("gemini search test fails clearly when no search sources come back", async () => {
    const a = getWebSearchAdapter("gemini_search", mockFetch(() => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }))));
    await expect(a.testConnection({ apiKey: "k", model: "m" })).rejects.toMatchObject({ code: "invalid_response" });
  });
});
