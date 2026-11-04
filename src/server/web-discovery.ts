import "server-only";
import { z } from "zod";
import { buildBusinessValidationPrompt } from "@/lib/ai/prompts";
import { businessValidationSchema } from "@/lib/ai/schemas";
import {
  appearsIn,
  classifyResults,
  instagramOutcome,
  planQueries,
  type InstagramOnlyCandidate,
  type ResearchCandidate,
  type WebQueryPlan,
} from "@/lib/discovery/web/candidates";
import { WEB_SEARCH_PROVIDER_IDS } from "@/lib/discovery/web/providers";
import { exclusionMatch } from "@/lib/discovery/types";
import type { InstagramEvidence } from "@/lib/identity/candidate";
import { normalizeWebsiteDomain, toCountryCode } from "@/lib/identity/normalize";
import { researchWebsite } from "@/lib/research/website";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json, Tables } from "@/lib/supabase/database.types";
import { generateStructured } from "./agent";
import { ingestRaw } from "./ingest";
import { getWebSearchCredentials } from "./providers";
import { toErrorMessage } from "./result";
import { getWorkspaceSettings } from "./settings";
import { assertWithinUsage, recordUsage } from "./usage";

type Job = Tables<"jobs">;

export const webDiscoveryParamsSchema = z.object({
  provider: z.enum(WEB_SEARCH_PROVIDER_IDS),
  query: z.object({
    keywords: z.string().trim().min(2).max(200),
    industry: z.string().trim().max(120).optional(),
    country: z.string().trim().max(80).optional(),
    city: z.string().trim().max(120).optional(),
    exclusions: z.array(z.string().trim().min(1).max(60)).max(30),
  }),
  /** Number of new prospects (with a verified Instagram profile when required) to find. */
  target_count: z.number().int().min(1).max(200),
  /** Hard cap on search requests for this job (cost control). */
  max_searches: z.number().int().min(1).max(100),
  require_verified_instagram: z.boolean(),
  auto_qualify: z.boolean(),
  auto_generate: z.boolean(),
});
export type WebDiscoveryParams = z.infer<typeof webDiscoveryParamsSchema>;

/** Search requests a job may use for a given target (shown to the user before starting). */
export function searchBudget(target: number): number {
  return Math.min(60, Math.max(4, Math.ceil(target / 2) + 3));
}

type PendingItem =
  | ({ type: "website" } & ResearchCandidate)
  | ({ type: "instagram" } & InstagramOnlyCandidate)
  | { type: "follow_up"; query: string; username: string; displayName: string };

interface WebCursor {
  plan: WebQueryPlan[];
  qi: number;
  page: number;
  searches: number;
  accepted: number;
  examined: number;
  pending: PendingItem[];
  seen: string[];
  exhausted?: boolean;
}

const MAX_SEEN = 3000;
const MAX_PENDING = 120;

async function event(db: AdminClient, job: Job, outcome: string, recordRef: string | null, message: string | null, data: Record<string, unknown> = {}) {
  await db.from("job_events").insert({ job_id: job.id, project_id: job.project_id, outcome, record_ref: recordRef, message, data: data as Json });
}

async function bump(db: AdminClient, jobId: string, f: Partial<Record<"processed" | "failed_count" | "skipped_count" | "known_count", number>>) {
  const { data } = await db.from("jobs").select("processed, failed_count, skipped_count, known_count").eq("id", jobId).single();
  if (!data) return;
  await db.from("jobs").update({
    processed: data.processed + (f.processed ?? 0),
    failed_count: data.failed_count + (f.failed_count ?? 0),
    skipped_count: data.skipped_count + (f.skipped_count ?? 0),
    known_count: data.known_count + (f.known_count ?? 0),
  }).eq("id", jobId);
}

function keysFor(domain: string | null, username: string | null) {
  return [
    ...(domain ? [{ type: "domain", value: domain }] : []),
    ...(username ? [{ type: "instagram_username", value: username }] : []),
  ];
}

async function lookup(db: AdminClient, projectId: string, keys: { type: string; value: string }[]) {
  if (!keys.length) return null;
  const { data, error } = await db.rpc("lookup_discovery_candidate", { p_project_id: projectId, p_keys: keys as unknown as Json });
  if (error) throw new Error(error.message);
  return data as { known_globally: boolean; in_project: boolean; suppressed: boolean; recently_rejected: string | null };
}

async function reject(db: AdminClient, job: Job, keys: { type: string; value: string }[], reason: string, ref: string) {
  if (keys.length) {
    await db.rpc("record_discovery_rejection", { p_project_id: job.project_id, p_keys: keys as unknown as Json, p_reason: reason, p_job_id: job.id });
  }
  await event(db, job, "excluded", ref, reason);
  await bump(db, job.id, { processed: 1, skipped_count: 1 });
}

function nameFromTitle(title: string | null): string | null {
  if (!title) return null;
  const part = title.split(/\s[|–—·-]\s|\s::\s/)[0]?.trim();
  return part && part.length >= 2 && part.length <= 80 ? part : null;
}

function displayNameFromInstagram(title: string): string | null {
  const m = title.match(/^(.*?)\s*\(@[a-z0-9._]+\)/i);
  const name = (m?.[1] ?? "").replace(/•.*$/, "").trim();
  return name.length >= 2 ? name.slice(0, 80) : null;
}

/** Researches one business website: robots-aware fetch, Instagram verification, AI validation, ingestion. */
async function processWebsite(db: AdminClient, job: Job, params: WebDiscoveryParams, c: ResearchCandidate, cursor: WebCursor, timeoutMs: number) {
  const { data: project } = await db.from("projects").select("ideal_customer_profile, exclusion_criteria").eq("id", job.project_id).single();
  const preKeys = keysFor(c.domain, c.hintedInstagram);
  const known = await lookup(db, job.project_id, preKeys);
  if (known?.in_project) {
    await event(db, job, "skipped_existing", c.domain, "Already in this project — not researched again");
    await bump(db, job.id, { processed: 1, skipped_count: 1, known_count: 1 });
    return;
  }
  if (known?.suppressed) {
    await event(db, job, "suppressed", c.domain, "On the do-not-contact list");
    await bump(db, job.id, { processed: 1, skipped_count: 1 });
    return;
  }
  if (known?.recently_rejected) {
    await event(db, job, "excluded", c.domain, `Skipped: previously rejected (${known.recently_rejected})`);
    await bump(db, job.id, { processed: 1, skipped_count: 1 });
    return;
  }

  cursor.examined++;
  const site = await researchWebsite(c.website, timeoutMs);
  const finalDomain = normalizeWebsiteDomain(site.source_url) ?? c.domain;
  if (site.error) {
    await reject(db, job, keysFor(finalDomain, null), `Website unavailable: ${site.error}`, c.domain);
    return;
  }

  const ig = instagramOutcome(site.facts.instagram_usernames, c.hintedInstagram);
  if (params.require_verified_instagram && ig.status !== "verified") {
    const why = ig.status === "conflicting" || ig.status === "likely"
      ? "Website links several Instagram accounts — not verified"
      : "No Instagram profile linked on the business website";
    await reject(db, job, keysFor(finalDomain, null), why, c.domain);
    return;
  }

  const hit = exclusionMatch({ business_name: `${site.title ?? ""} ${c.searchTitle}`, category: site.description, website: site.source_url }, params.query.exclusions);
  if (hit) {
    await reject(db, job, keysFor(finalDomain, null), `Matches exclusion “${hit}”`, c.domain);
    return;
  }

  // Gemini validates relevance and extracts facts that are written on the page.
  const { system, prompt } = buildBusinessValidationPrompt(
    { ...params.query, idealCustomer: project?.ideal_customer_profile, exclusions: [project?.exclusion_criteria, params.query.exclusions.join(", ")].filter(Boolean).join("; ") },
    { url: site.source_url, title: site.title, description: site.description, text: site.text, searchTitle: c.searchTitle, searchSnippet: c.searchSnippet },
  );
  const { data: v } = await generateStructured(db, businessValidationSchema, { system, prompt }, {
    actorId: job.created_by, jobId: job.id, projectId: job.project_id, operation: "validate_business",
  });
  if (!v.is_business_website || !v.matches_target) {
    await reject(db, job, keysFor(finalDomain, null), `Not a match: ${v.reason}`, c.domain);
    return;
  }

  const sourceText = [site.title, site.siteName, site.description, site.text, c.searchTitle, c.searchSnippet].filter(Boolean).join("\n");
  const name = (appearsIn(v.business_name, sourceText) ? v.business_name : null) ?? site.siteName ?? nameFromTitle(site.title) ?? nameFromTitle(c.searchTitle);
  if (!name) {
    await reject(db, job, keysFor(finalDomain, null), "Couldn't determine the business name from the website", c.domain);
    return;
  }
  const city = appearsIn(v.city, sourceText) ? v.city : params.query.city ?? null;
  const country = (appearsIn(v.country, sourceText) && toCountryCode(v.country) ? v.country : null) ?? params.query.country ?? null;
  const now = new Date().toISOString();
  const verified = ig.status === "verified" ? ig.username : null;
  const likely = !verified && ig.username ? ig.username : null;

  const res = await ingestRaw(db, job.project_id, {
    business_name: name,
    category: v.category && appearsIn(v.category, sourceText) ? v.category : null,
    city,
    country,
    website: site.source_url,
    email: site.facts.emails[0] ?? null,
    instagram: verified ?? likely,
    instagram_source: verified ? "business_website" : "search",
    source: `web_${params.provider}`,
    source_ref: site.source_url,
    source_data: {
      provider: params.provider,
      search_query: cursor.plan[Math.min(cursor.qi, cursor.plan.length - 1)]?.query ?? null,
      search_result_url: c.sourceUrl,
      search_title: c.searchTitle,
      location_from: city && appearsIn(city, sourceText) ? "website" : "search_query",
      ai_validation: { reason: v.reason },
    },
  }, job.id, job.created_by);

  if (res.prospect_id && (res.outcome === "new" || res.outcome === "known_added")) {
    // Store the research we already did, so qualification doesn't fetch the site again.
    const evidence: InstagramEvidence[] = verified
      ? [{ username: verified, source: "business_website", url: site.source_url, detail: "Linked from the business website", observed_at: now }]
      : likely
        ? [{ username: likely, source: "search", url: c.sourceUrl, detail: "Found via web search; the website links several accounts", observed_at: now }]
        : [];
    await db.from("research_results").insert({
      project_id: job.project_id,
      prospect_id: res.prospect_id,
      source_url: site.source_url,
      http_status: site.http_status,
      title: site.title,
      content_excerpt: [site.description, site.text].filter(Boolean).join("\n\n").slice(0, 5000) || null,
      extracted: site.facts as unknown as Json,
    });
    await db.from("project_prospects").update({
      last_researched_at: now,
      instagram_evidence: evidence as unknown as Json,
      ...(ig.status === "conflicting" ? { instagram_match_status: "conflicting" as const } : !verified && !likely ? { instagram_match_status: "not_found" as const } : {}),
    }).eq("id", res.prospect_id);
    await db.from("outreach_activities").insert({
      project_id: job.project_id, prospect_id: res.prospect_id, actor_id: job.created_by, type: "discovered", is_manual: false,
      details: { job_id: job.id, provider: params.provider, instagram: verified ?? likely, instagram_status: verified ? "verified" : likely ? "likely" : ig.status },
    });
    cursor.accepted++;
  }
  await event(db, job, res.outcome, name, null, {
    prospect_id: res.prospect_id, ambiguous_id: res.ambiguous_id, website: site.source_url,
    instagram: verified ?? likely, instagram_status: verified ? "verified" : likely ? "likely" : ig.status,
  });
}

/** An Instagram profile found by search: we look for its website, which must link back to it. */
async function processInstagram(db: AdminClient, job: Job, params: WebDiscoveryParams, c: InstagramOnlyCandidate, cursor: WebCursor) {
  const known = await lookup(db, job.project_id, keysFor(null, c.username));
  if (known?.in_project) {
    await event(db, job, "skipped_existing", `@${c.username}`, "Already in this project — not researched again");
    await bump(db, job.id, { processed: 1, skipped_count: 1, known_count: 1 });
    return;
  }
  if (known?.suppressed || known?.recently_rejected) {
    await event(db, job, known.suppressed ? "suppressed" : "excluded", `@${c.username}`, known.suppressed ? "On the do-not-contact list" : `Skipped: previously rejected (${known.recently_rejected})`);
    await bump(db, job.id, { processed: 1, skipped_count: 1 });
    return;
  }
  const displayName = displayNameFromInstagram(c.searchTitle) ?? c.username;
  const location = [params.query.city, params.query.country].filter(Boolean).join(" ");
  cursor.pending.unshift({ type: "follow_up", query: `"${displayName}" ${location} website`.trim(), username: c.username, displayName });
}

async function processFollowUp(db: AdminClient, job: Job, params: WebDiscoveryParams, item: Extract<PendingItem, { type: "follow_up" }>, cursor: WebCursor) {
  if (cursor.searches >= params.max_searches) {
    await reject(db, job, keysFor(null, item.username), "Search budget used up before its website could be found", `@${item.username}`);
    return;
  }
  const results = await runSearch(db, job, params, { query: item.query, kind: "web" }, 0, cursor);
  const { websites } = classifyResults(results);
  const site = websites.find((w) => !cursor.seen.includes(`d:${w.domain}`));
  if (!site) {
    await reject(db, job, keysFor(null, item.username), "No business website found for this Instagram profile", `@${item.username}`);
    return;
  }
  cursor.seen.push(`d:${site.domain}`);
  cursor.pending.unshift({ type: "website", ...site, hintedInstagram: item.username });
}

async function runSearch(db: AdminClient, job: Job, params: WebDiscoveryParams, plan: WebQueryPlan, page: number, cursor: WebCursor) {
  await assertWithinUsage(db, "discovery");
  const { cred, adapter } = await getWebSearchCredentials(db, params.provider);
  cursor.searches++;
  try {
    const results = await adapter.search(cred, plan, { page, countryCode: toCountryCode(params.query.country) });
    await recordUsage(db, { kind: "discovery", provider: params.provider, operation: "web_search", projectId: job.project_id, userId: job.created_by, jobId: job.id, success: true });
    return results;
  } catch (err) {
    await recordUsage(db, { kind: "discovery", provider: params.provider, operation: "web_search", projectId: job.project_id, userId: job.created_by, jobId: job.id, success: false });
    throw err;
  }
}

/**
 * One bounded slice of a web discovery job. Alternates between running a search and researching
 * queued candidates until the time budget is spent. Progress lives in the job cursor.
 */
export async function webDiscoveryStep(db: AdminClient, job: Job, deadline: number) {
  const params = webDiscoveryParamsSchema.parse(job.params);
  const { limits } = await getWorkspaceSettings(db);
  const raw = (job.cursor ?? {}) as Partial<WebCursor>;
  const cursor: WebCursor = {
    plan: raw.plan?.length ? raw.plan : planQueries(params.query),
    qi: raw.qi ?? 0,
    page: raw.page ?? 0,
    searches: raw.searches ?? 0,
    accepted: raw.accepted ?? 0,
    examined: raw.examined ?? 0,
    pending: raw.pending ?? [],
    seen: raw.seen ?? [],
    exhausted: raw.exhausted ?? false,
  };

  const finished = () => cursor.accepted >= params.target_count || (cursor.pending.length === 0 && (cursor.exhausted || cursor.searches >= params.max_searches));

  try {
  while (!finished() && Date.now() < deadline - 3_000) {
    const { data: fresh } = await db.from("jobs").select("cancel_requested").eq("id", job.id).single();
    if (fresh?.cancel_requested) break;

    if (cursor.pending.length === 0) {
      if (cursor.qi >= cursor.plan.length) {
        cursor.exhausted = true;
        break;
      }
      const plan = cursor.plan[cursor.qi];
      const { getWebSearchAdapter } = await import("@/lib/discovery/web/providers");
      const supportsPaging = getWebSearchAdapter(params.provider).supportsPaging;
      const results = await runSearch(db, job, params, plan, cursor.page, cursor);
      const { websites, instagram, dropped } = classifyResults(results);
      let queued = 0;
      for (const w of websites) {
        if (cursor.seen.includes(`d:${w.domain}`)) continue;
        cursor.seen.push(`d:${w.domain}`);
        if (w.hintedInstagram) cursor.seen.push(`i:${w.hintedInstagram}`);
        cursor.pending.push({ type: "website", ...w });
        queued++;
      }
      for (const i of instagram) {
        if (cursor.seen.includes(`i:${i.username}`)) continue;
        cursor.seen.push(`i:${i.username}`);
        cursor.pending.push({ type: "instagram", ...i });
        queued++;
      }
      cursor.pending = cursor.pending.slice(0, MAX_PENDING);
      cursor.seen = cursor.seen.slice(-MAX_SEEN);
      await event(db, job, "search", plan.query, `${results.length} results · ${queued} new candidates · ${dropped.length} directories or other pages skipped`, { page: cursor.page });
      // Page deeper only while a query keeps producing new candidates.
      if (supportsPaging && cursor.page < 2 && queued >= 3 && results.length >= 8) cursor.page++;
      else {
        cursor.qi++;
        cursor.page = 0;
      }
      continue;
    }

    const item = cursor.pending.shift()!;
    const ref = item.type === "website" ? item.domain : `@${item.username}`;
    try {
      if (item.type === "website") await processWebsite(db, job, params, item, cursor, limits.research_fetch_timeout_ms);
      else if (item.type === "instagram") await processInstagram(db, job, params, item, cursor);
      else await processFollowUp(db, job, params, item, cursor);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
      const fatal = ["auth", "permission", "quota", "not_configured", "not_found"].includes(code);
      const transient = ["rate_limit", "server", "timeout", "network"].includes(code);
      if (fatal || transient || (err instanceof Error && err.name === "UsageLimitError")) {
        cursor.pending.unshift(item); // retry this record after the problem is fixed
        throw err;
      }
      await event(db, job, "failed", ref, toErrorMessage(err));
      await bump(db, job.id, { processed: 1, failed_count: 1 });
    }
  }
  } catch (err) {
    // Keep progress (seen candidates, accepted count) so a retry resumes instead of repeating work.
    await db.from("jobs").update({ cursor: cursor as unknown as Json }).eq("id", job.id);
    throw err;
  }

  return {
    done: finished(),
    cursor: cursor as unknown as Record<string, unknown>,
    total: params.target_count,
  };
}
