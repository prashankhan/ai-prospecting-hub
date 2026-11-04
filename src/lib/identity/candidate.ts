import { z } from "zod";
import {
  cleanUrl,
  countryName,
  instagramProfileUrl,
  normalizeBusinessName,
  normalizeCity,
  normalizeEmail,
  normalizeInstagramUsername,
  normalizePhone,
  normalizeWebsiteDomain,
  toCountryCode,
} from "./normalize";

export const INSTAGRAM_MATCH_STATUSES = ["unknown", "verified", "likely", "not_found", "conflicting"] as const;
export type InstagramMatchStatus = (typeof INSTAGRAM_MATCH_STATUSES)[number];

export type InstagramEvidenceSource =
  | "business_website" // link published on the business's own website
  | "provider" // returned by an authorized data provider
  | "csv" // supplied by a user in an import
  | "manual" // a team member verified the profile by hand
  | "search"; // permitted public search result

export interface InstagramEvidence {
  username: string;
  source: InstagramEvidenceSource;
  url?: string;
  detail?: string;
  observed_at: string;
  actor_id?: string;
}

const VERIFYING_SOURCES: InstagramEvidenceSource[] = ["business_website", "manual"];

/**
 * Classifies Instagram profile matching from recorded evidence. Never infers a username that is
 * not present in evidence.
 *  - verified: one username, corroborated by the business website or a manual check
 *  - likely: one username from an unverified source — review required
 *  - conflicting: more than one distinct username
 *  - not_found: lookup performed, nothing found
 */
export function classifyInstagram(
  evidence: InstagramEvidence[],
  lookupPerformed: boolean,
): { status: InstagramMatchStatus; username: string | null } {
  const usernames = [...new Set(evidence.map((e) => e.username))];
  if (usernames.length === 0) return { status: lookupPerformed ? "not_found" : "unknown", username: null };
  if (usernames.length > 1) {
    // A manual verification resolves a conflict in favour of the verified handle.
    const manual = [...evidence].reverse().find((e) => e.source === "manual");
    if (manual) return { status: "verified", username: manual.username };
    return { status: "conflicting", username: null };
  }
  const username = usernames[0];
  const verified = evidence.some((e) => VERIFYING_SOURCES.includes(e.source));
  return { status: verified ? "verified" : "likely", username };
}

export function mergeEvidence(existing: InstagramEvidence[], incoming: InstagramEvidence[]): InstagramEvidence[] {
  const seen = new Set(existing.map((e) => `${e.username}|${e.source}|${e.url ?? ""}`));
  const out = [...existing];
  for (const e of incoming) {
    const key = `${e.username}|${e.source}|${e.url ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(e);
    }
  }
  return out;
}

export const rawCandidateSchema = z.object({
  business_name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(120).optional().nullable(),
  country: z.string().trim().max(80).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  website: z.string().trim().max(500).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  instagram: z.string().trim().max(300).optional().nullable(),
  instagram_source: z.enum(["business_website", "provider", "csv", "manual", "search"]).optional(),
  place_id: z.string().trim().max(300).optional().nullable(),
  source: z.string().min(1).max(40),
  source_ref: z.string().max(300).optional().nullable(),
  source_data: z.record(z.string(), z.unknown()).optional(),
});
export type RawCandidate = z.infer<typeof rawCandidateSchema>;

export interface IdentityKey {
  type: "instagram_username" | "instagram_id" | "place_id" | "domain" | "phone";
  value: string;
}

export interface CandidatePayload {
  business_name: string;
  normalized_name: string;
  country_code: string | null;
  city_normalized: string | null;
  category: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  instagram_username: string | null;
  instagram_url: string | null;
  instagram_match_status: InstagramMatchStatus;
  instagram_evidence: InstagramEvidence[];
  source: string;
  source_ref: string | null;
  source_data: Record<string, unknown>;
  keys: IdentityKey[];
}

/**
 * Turns raw provider/CSV data into the normalized payload accepted by
 * `ingest_prospect_candidate`. Original values are preserved in `source_data.original`.
 */
export function buildCandidate(raw: RawCandidate, now = new Date()): CandidatePayload {
  const parsed = rawCandidateSchema.parse(raw);
  const countryCode = toCountryCode(parsed.country);
  const website = cleanUrl(parsed.website);
  const domain = normalizeWebsiteDomain(parsed.website);
  const phoneKey = normalizePhone(parsed.phone, countryCode);
  const email = normalizeEmail(parsed.email);

  // A website field that is actually an Instagram profile is treated as Instagram evidence.
  const igInput = parsed.instagram || (parsed.website && /instagram\.com/i.test(parsed.website) ? parsed.website : null);
  const username = normalizeInstagramUsername(igInput);
  const evidence: InstagramEvidence[] = username
    ? [{
        username,
        source: parsed.instagram_source ?? (parsed.source === "csv" ? "csv" : "provider"),
        url: instagramProfileUrl(username),
        detail: `Supplied by ${parsed.source}`,
        observed_at: now.toISOString(),
      }]
    : [];
  const ig = classifyInstagram(evidence, false);

  const keys: IdentityKey[] = [];
  if (parsed.place_id) keys.push({ type: "place_id", value: parsed.place_id });
  if (username) keys.push({ type: "instagram_username", value: username });
  if (domain) keys.push({ type: "domain", value: domain });
  if (phoneKey) keys.push({ type: "phone", value: phoneKey });

  return {
    business_name: parsed.business_name,
    normalized_name: normalizeBusinessName(parsed.business_name) || parsed.business_name.toLowerCase(),
    country_code: countryCode,
    city_normalized: normalizeCity(parsed.city),
    category: parsed.category || null,
    country: countryCode ? countryName(countryCode) : parsed.country || null,
    city: parsed.city || null,
    address: parsed.address || null,
    website: website && !/instagram\.com/i.test(website) ? website : null,
    phone: parsed.phone || null,
    email,
    instagram_username: ig.username,
    instagram_url: ig.username ? instagramProfileUrl(ig.username) : null,
    instagram_match_status: ig.status,
    instagram_evidence: evidence,
    source: parsed.source,
    source_ref: parsed.source_ref || parsed.place_id || null,
    source_data: { ...(parsed.source_data ?? {}), original: raw },
    keys,
  };
}

export const INGEST_OUTCOMES = [
  "new", "known_added", "updated", "skipped_existing", "skipped_other_project", "suppressed", "ambiguous",
] as const;
export type IngestOutcome = (typeof INGEST_OUTCOMES)[number];

export const ingestResultSchema = z.object({
  outcome: z.enum(INGEST_OUTCOMES),
  prospect_id: z.string().uuid().nullable(),
  identity_id: z.string().uuid().nullable(),
  ambiguous_id: z.string().uuid().nullable(),
});
export type IngestResult = z.infer<typeof ingestResultSchema>;
