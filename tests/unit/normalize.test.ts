import { describe, expect, it } from "vitest";
import {
  cleanUrl, normalizeBusinessName, normalizeCity, normalizeEmail, normalizeInstagramUsername, normalizePhone,
  normalizeWebsiteDomain, toCountryCode,
} from "@/lib/identity/normalize";

describe("normalizeInstagramUsername", () => {
  it.each([
    ["@InkHouse", "inkhouse"],
    ["inkhouse", "inkhouse"],
    ["https://www.instagram.com/InkHouse/", "inkhouse"],
    ["instagram.com/ink.house_nyc?igshid=abc123", "ink.house_nyc"],
    ["https://instagram.com/inkhouse/reels/", "inkhouse"],
    ["http://instagr.am/inkhouse", "inkhouse"],
    ["  @@ink_house  ", "ink_house"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeInstagramUsername(input)).toBe(expected);
  });

  it.each([
    "", null, "https://www.instagram.com/", "https://www.instagram.com/p/Cx123/", "https://www.instagram.com/explore/tags/tattoo",
    "https://facebook.com/inkhouse", "ink house", ".inkhouse", "inkhouse.", "ink..house", "a".repeat(31), "reels",
    "https://www.instagram.com/inkhouse/p/abc",
  ])("rejects %s", (input) => {
    expect(normalizeInstagramUsername(input)).toBeNull();
  });
});

describe("normalizeWebsiteDomain", () => {
  it.each([
    ["https://www.InkHouse.com/about?utm_source=x", "inkhouse.com"],
    ["inkhouse.co.uk", "inkhouse.co.uk"],
    ["http://shop.inkhouse.com:443/", "shop.inkhouse.com"],
    ["https://inkhouse.square.site/", "inkhouse.square.site"],
    ["https://inkhouse.wixsite.com/home", "inkhouse.wixsite.com"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeWebsiteDomain(input)).toBe(expected);
  });

  it.each([
    "https://instagram.com/inkhouse", "https://linktr.ee/inkhouse", "https://www.facebook.com/inkhouse",
    "https://booksy.com/en-us/123_ink", "https://maps.app.goo.gl/abc", "https://wixsite.com/inkhouse",
    "not a url", "http://127.0.0.1/", "mailto:a@b.com", "",
  ])("rejects shared or invalid %s", (input) => {
    expect(normalizeWebsiteDomain(input)).toBeNull();
  });
});

describe("cleanUrl", () => {
  it("removes tracking parameters and fragments but keeps meaningful ones", () => {
    expect(cleanUrl("HTTPS://Example.COM/page?utm_campaign=a&id=5&fbclid=z#top")).toBe("https://example.com/page?id=5");
    expect(cleanUrl("example.com")).toBe("https://example.com");
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("normalizeBusinessName", () => {
  it("is conservative and stable", () => {
    expect(normalizeBusinessName("The Ink & Needle Tattoo Co.")).toBe("ink and needle tattoo");
    expect(normalizeBusinessName("Café Tätowierung LLC")).toBe("cafe tatowierung");
    expect(normalizeBusinessName("O'Reilly's Tattoo Studio, Inc.")).toBe("oreillys tattoo studio");
    expect(normalizeBusinessName("INK   HOUSE")).toBe(normalizeBusinessName("ink house"));
  });
  it("keeps descriptive words to avoid over-merging", () => {
    expect(normalizeBusinessName("Ink House Tattoo")).not.toBe(normalizeBusinessName("Ink House Piercing"));
  });
});

describe("location normalization", () => {
  it("maps country names and aliases to ISO codes", () => {
    expect(toCountryCode("USA")).toBe("US");
    expect(toCountryCode("United States")).toBe("US");
    expect(toCountryCode("U.K.")).toBe("GB");
    expect(toCountryCode("England")).toBe("GB");
    expect(toCountryCode("canada")).toBe("CA");
    expect(toCountryCode("Germany")).toBe("DE");
    expect(toCountryCode("de")).toBe("DE");
    expect(toCountryCode("Atlantis")).toBeNull();
  });
  it("normalizes cities", () => {
    expect(normalizeCity("  Montréal ")).toBe("montreal");
    expect(normalizeCity("St. John's")).toBe("st john s");
  });
});

describe("normalizePhone", () => {
  it("normalizes unambiguous numbers", () => {
    expect(normalizePhone("(512) 555-0100", "US")).toBe("+15125550100");
    expect(normalizePhone("1-512-555-0100", "CA")).toBe("+15125550100");
    expect(normalizePhone("020 7946 0958", "GB")).toBe("+442079460958");
    expect(normalizePhone("+44 20 7946 0958", null)).toBe("+442079460958");
  });
  it("refuses to guess", () => {
    expect(normalizePhone("555-0100", "US")).toBeNull();
    expect(normalizePhone("030 123456", "DE")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("accepts mailto links and rejects junk", () => {
    expect(normalizeEmail("mailto:Hello@InkHouse.com?subject=hi")).toBe("hello@inkhouse.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
});
