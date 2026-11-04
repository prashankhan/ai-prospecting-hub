import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, loadEncryptionKey, redactSecrets, secretHint } from "@/lib/security/crypto";
import { assertPublicUrl, isPrivateAddress } from "@/lib/security/safe-fetch";
import { extractFacts, isAllowedByRobots } from "@/lib/research/extract";
import { escapeCsvCell } from "@/lib/csv/format";
import { effectivePolicy, needsResearch } from "@/lib/domain/policy";

describe("credential encryption", () => {
  const key = randomBytes(32);
  it("round-trips and uses a fresh IV", () => {
    const a = encryptSecret("AIzaSecret", key);
    const b = encryptSecret("AIzaSecret", key);
    expect(a).not.toBe(b);
    expect(a).not.toContain("AIzaSecret");
    expect(decryptSecret(a, key)).toBe("AIzaSecret");
  });
  it("detects tampering and wrong keys", () => {
    const env = encryptSecret("secret", key);
    const parts = env.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret(env, randomBytes(32))).toThrow();
  });
  it("validates the environment key", () => {
    expect(() => loadEncryptionKey(undefined)).toThrow(/not set/);
    expect(() => loadEncryptionKey(Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
  });
  it("never reveals more than the last 4 characters", () => {
    expect(secretHint("sk-abcdefgh1234")).toBe("••••1234");
    expect(redactSecrets("bad key AIzaSyA1234567890123456789012 in https://x?key=abc", [])).not.toMatch(/AIza|key=abc/);
  });
});

describe("SSRF protection", () => {
  it("rejects private and special addresses", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });
  it("rejects unsafe URLs before any request", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertPublicUrl("http://localhost:3000")).rejects.toThrow();
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(assertPublicUrl("https://user:pass@example.com")).rejects.toThrow();
    await expect(assertPublicUrl("https://example.com:8443")).rejects.toThrow();
  });
});

describe("website fact extraction", () => {
  it("finds published Instagram profiles and mailto emails only", () => {
    const html = `<a href="https://www.instagram.com/InkHouse/">IG</a><a href="https://instagram.com/p/xyz">post</a>
      <a href="mailto:Hello@InkHouse.com">Email</a> contact: other@example.com <a href="https://facebook.com/inkhouse">fb</a>`;
    const facts = extractFacts(html, "https://inkhouse.com");
    expect(facts.instagram_usernames).toEqual(["inkhouse"]);
    expect(facts.emails).toEqual(["hello@inkhouse.com"]);
    expect(facts.social_links.facebook).toHaveLength(1);
  });
  it("respects robots.txt", () => {
    expect(isAllowedByRobots("User-agent: *\nDisallow: /", "/")).toBe(false);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /admin", "/")).toBe(true);
    expect(isAllowedByRobots("User-agent: AIProspectingHubBot\nDisallow: /\n\nUser-agent: *\nAllow: /", "/")).toBe(false);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /\nAllow: /$", "/")).toBe(true);
  });
});

describe("CSV safety", () => {
  it("neutralizes spreadsheet formulas and quotes values", () => {
    expect(escapeCsvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(escapeCsvCell("+1 555")).toBe("'+1 555");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell(null)).toBe("");
  });
});

describe("duplicate policy", () => {
  it("defaults to strict settings and applies overrides", () => {
    const p = effectivePolicy({}, { refresh_interval_days: 30 });
    expect(p.global_identity_detection).toBe(true);
    expect(p.block_repeat_outreach).toBe(true);
    expect(p.automatic_reprocessing).toBe(false);
    expect(p.ambiguous_requires_review).toBe(true);
    expect(p.suppress_do_not_contact).toBe(true);
    expect(p.refresh_interval_days).toBe(30);
  });
  it("skips unnecessary enrichment within the refresh interval", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const policy = { skip_unnecessary_enrichment: true, refresh_interval_days: 90 };
    expect(needsResearch(null, policy, { now })).toBe(true);
    expect(needsResearch("2026-05-01T00:00:00Z", policy, { now })).toBe(false);
    expect(needsResearch("2026-01-01T00:00:00Z", policy, { now })).toBe(true);
    expect(needsResearch("2026-05-01T00:00:00Z", policy, { now, force: true })).toBe(true);
  });
});
