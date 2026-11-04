import "server-only";
import type { z } from "zod";
import { extractJSONObject } from "@/lib/ai/http";
import { buildMessagePrompt, buildQualificationPrompt, type ProjectBrief } from "@/lib/ai/prompts";
import {
  decideQualificationStatus,
  enforceProvenance,
  messageOutputSchema,
  qualificationOutputSchema,
  type SourceDoc,
} from "@/lib/ai/schemas";
import { ProviderError } from "@/lib/ai/types";
import { classifyInstagram, mergeEvidence, type InstagramEvidence } from "@/lib/identity/candidate";
import { instagramProfileUrl } from "@/lib/identity/normalize";
import { isPostContact, type OutreachStatus } from "@/lib/domain/outreach";
import { needsResearch, type DuplicatePolicy } from "@/lib/domain/policy";
import { researchWebsite } from "@/lib/research/website";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json, Tables } from "@/lib/supabase/database.types";
import { getActiveAI } from "./providers";
import { check, UserFacingError } from "./result";
import { getProjectPolicy, getWorkspaceSettings } from "./settings";
import { assertWithinUsage, recordUsage } from "./usage";

type Prospect = Tables<"project_prospects">;
type Project = Tables<"projects">;

export interface AgentContext {
  actorId: string | null;
  jobId?: string | null;
}

// ---------------------------------------------------------------------------
// Structured generation with validation, one repair attempt and usage metering
// ---------------------------------------------------------------------------
export async function generateStructured<S extends z.ZodType>(
  db: AdminClient,
  schema: S,
  input: { system: string; prompt: string },
  ctx: AgentContext & { projectId: string; operation: string },
): Promise<{ data: z.infer<S>; provider: string; model: string }> {
  const ai = await getActiveAI(db);
  let prompt = input.prompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    await assertWithinUsage(db, "ai");
    let text: string;
    try {
      text = (await ai.adapter.generateJSON({ apiKey: ai.apiKey, model: ai.model, system: input.system, prompt })).text;
      await recordUsage(db, { kind: "ai", provider: ai.provider, operation: ctx.operation, projectId: ctx.projectId, userId: ctx.actorId, jobId: ctx.jobId, success: true });
    } catch (err) {
      await recordUsage(db, { kind: "ai", provider: ai.provider, operation: ctx.operation, projectId: ctx.projectId, userId: ctx.actorId, jobId: ctx.jobId, success: false });
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = extractJSONObject(text);
    } catch {
      parsed = undefined;
    }
    const result = schema.safeParse(parsed);
    if (result.success) return { data: result.data, provider: ai.provider, model: ai.model };
    const issues = result.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    prompt = `${input.prompt}\n\nYour previous answer was invalid (${issues || "not valid JSON"}). Return only a JSON object that matches the required shape.`;
  }
  throw new ProviderError(ai.provider, "invalid_response", "The model did not return valid structured output after a retry.");
}

// ---------------------------------------------------------------------------
// Loading helpers
// ---------------------------------------------------------------------------
export async function loadProspect(db: AdminClient, prospectId: string) {
  const prospect = check(await db.from("project_prospects").select("*").eq("id", prospectId).single());
  const project = check(await db.from("projects").select("*").eq("id", prospect.project_id).single());
  return { prospect, project };
}

function brief(p: Project): ProjectBrief {
  return {
    name: p.name,
    product_name: p.product_name,
    product_description: p.product_description,
    target_industry: p.target_industry,
    target_countries: p.target_countries,
    ideal_customer_profile: p.ideal_customer_profile,
    qualification_criteria: p.qualification_criteria,
    exclusion_criteria: p.exclusion_criteria,
    messaging_tone: p.messaging_tone,
    ai_instructions: p.ai_instructions,
    outreach_objective: p.outreach_objective,
    preferred_channel: p.preferred_channel,
  };
}

// ---------------------------------------------------------------------------
// Stage: research (tool: website fetch). Reuses recent research when policy allows.
// ---------------------------------------------------------------------------
export async function researchProspect(
  db: AdminClient,
  prospect: Prospect,
  policy: DuplicatePolicy,
  opts: { force?: boolean; timeoutMs: number; actorId: string | null },
): Promise<{ prospect: Prospect; research: Tables<"research_results">[]; fetched: boolean }> {
  const existing = check(
    await db.from("research_results").select("*").eq("prospect_id", prospect.id).order("fetched_at", { ascending: false }).limit(3),
  );
  if (!needsResearch(prospect.last_researched_at, policy, { force: opts.force }) || !prospect.website) {
    if (!prospect.website && !prospect.last_researched_at) {
      // Nothing to fetch; record that research ran so the stage is not repeated needlessly.
      const updated = check(
        await db.from("project_prospects").update({ last_researched_at: new Date().toISOString() }).eq("id", prospect.id).select("*").single(),
      );
      return { prospect: updated, research: existing, fetched: false };
    }
    return { prospect, research: existing, fetched: false };
  }

  const result = await researchWebsite(prospect.website, opts.timeoutMs);
  const row = check(
    await db
      .from("research_results")
      .insert({
        project_id: prospect.project_id,
        prospect_id: prospect.id,
        source_url: result.source_url,
        http_status: result.http_status,
        title: result.title,
        content_excerpt: [result.description, result.text].filter(Boolean).join("\n\n").slice(0, 5000) || null,
        extracted: result.facts as unknown as Json,
        error: result.error,
      })
      .select("*")
      .single(),
  );

  const now = new Date().toISOString();
  const incoming: InstagramEvidence[] = result.facts.instagram_usernames.map((username) => ({
    username,
    source: "business_website",
    url: result.source_url,
    detail: "Linked from the business website",
    observed_at: now,
  }));
  const evidence = mergeEvidence((prospect.instagram_evidence as unknown as InstagramEvidence[]) ?? [], incoming);
  const lookupPerformed = !result.error;
  const ig = classifyInstagram(evidence, lookupPerformed || evidence.length > 0);
  // Keep a manually verified handle even if the website later lists something different.
  const keepManual = prospect.instagram_match_status === "verified" && evidence.some((e) => e.source === "manual");

  const updated = check(
    await db
      .from("project_prospects")
      .update({
        last_researched_at: now,
        instagram_evidence: evidence as unknown as Json,
        ...(keepManual
          ? {}
          : {
              instagram_match_status: ig.status === "unknown" ? prospect.instagram_match_status : ig.status,
              instagram_username: ig.username ?? (ig.status === "conflicting" ? null : prospect.instagram_username),
              instagram_url: ig.username ? instagramProfileUrl(ig.username) : ig.status === "conflicting" ? null : prospect.instagram_url,
            }),
        email: prospect.email ?? result.facts.emails[0] ?? null,
      })
      .eq("id", prospect.id)
      .select("*")
      .single(),
  );
  return { prospect: updated, research: [row, ...existing].slice(0, 3), fetched: true };
}

function buildSources(prospect: Prospect, research: Tables<"research_results">[]): SourceDoc[] {
  const sd = (prospect.source_data ?? {}) as Record<string, unknown>;
  const record = [
    `Business name: ${prospect.business_name}`,
    prospect.category && `Category: ${prospect.category}`,
    prospect.address && `Address: ${prospect.address}`,
    prospect.city && `City: ${prospect.city}`,
    prospect.country && `Country: ${prospect.country}`,
    prospect.website && `Website: ${prospect.website}`,
    prospect.phone && `Public phone: ${prospect.phone}`,
    prospect.instagram_username && `Instagram: @${prospect.instagram_username} (match status: ${prospect.instagram_match_status})`,
    Array.isArray(sd.types) && sd.types.length ? `Place types: ${(sd.types as string[]).join(", ")}` : null,
    typeof sd.business_status === "string" ? `Business status: ${sd.business_status}` : null,
  ].filter(Boolean).join("\n");

  const sources: SourceDoc[] = [{ ref: "S1", kind: "source_record", label: `Discovery record (${prospect.source})`, content: record }];
  const seen = new Set<string>();
  for (const r of research) {
    if (r.error || !r.content_excerpt || seen.has(r.source_url)) continue;
    seen.add(r.source_url);
    sources.push({
      ref: `S${sources.length + 1}`,
      kind: "website",
      label: r.title ?? "Business website",
      url: r.source_url,
      content: r.content_excerpt,
    });
    if (sources.length >= 3) break;
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Stage: qualify
// ---------------------------------------------------------------------------
export async function qualifyProspect(db: AdminClient, prospectId: string, ctx: AgentContext & { forceResearch?: boolean }) {
  await getActiveAI(db); // fail fast before spending a website fetch
  await assertWithinUsage(db, "ai");
  const { prospect: initial, project } = await loadProspect(db, prospectId);
  const [policy, { limits }] = await Promise.all([getProjectPolicy(db, project.id), getWorkspaceSettings(db)]);
  const { prospect, research } = await researchProspect(db, initial, policy, {
    force: ctx.forceResearch, timeoutMs: limits.research_fetch_timeout_ms, actorId: ctx.actorId,
  });
  const sources = buildSources(prospect, research);
  const { system, prompt } = buildQualificationPrompt(brief(project), sources, project.qualification_threshold);
  const { data, provider, model } = await generateStructured(db, qualificationOutputSchema, { system, prompt }, {
    ...ctx, projectId: project.id, operation: "qualify",
  });
  const { kept, rejected } = enforceProvenance(data.evidence, sources);
  const status = decideQualificationStatus(data, project.qualification_threshold, kept.length);
  const researchedAt = new Date().toISOString();

  const result = check(
    await db
      .from("qualification_results")
      .insert({
        project_id: project.id,
        prospect_id: prospect.id,
        provider,
        model,
        score: data.score,
        recommended_status: status,
        explanation: data.explanation,
        evidence: kept as unknown as Json,
        source_refs: sources.map((s) => ({ ref: s.ref, kind: s.kind, label: s.label, url: s.url ?? null })) as unknown as Json,
        missing_information: [
          ...data.missing_information,
          ...(rejected.length ? [`${rejected.length} evidence item(s) were discarded because they cited unknown sources`] : []),
        ] as unknown as Json,
        researched_at: researchedAt,
        created_by: ctx.actorId,
      })
      .select("*")
      .single(),
  );
  await db
    .from("project_prospects")
    .update({ qualification_score: data.score, qualification_status: status, qualification_summary: data.explanation })
    .eq("id", prospect.id);
  await db.from("outreach_activities").insert({
    project_id: project.id,
    prospect_id: prospect.id,
    actor_id: ctx.actorId,
    type: "qualified",
    is_manual: false,
    details: { score: data.score, status, provider, model, job_id: ctx.jobId ?? null },
  });
  return result;
}

// ---------------------------------------------------------------------------
// Stage: generate
// ---------------------------------------------------------------------------
export async function generateDraft(db: AdminClient, prospectId: string, ctx: AgentContext) {
  await getActiveAI(db);
  await assertWithinUsage(db, "ai");
  const { prospect: initial, project } = await loadProspect(db, prospectId);
  const policy = await getProjectPolicy(db, project.id);
  if (initial.do_not_contact) throw new UserFacingError("This prospect is marked do not contact.");
  if (isPostContact(initial.outreach_status as OutreachStatus) && policy.block_repeat_outreach) {
    throw new UserFacingError("This prospect was already contacted. Repeat outreach is blocked by policy.");
  }
  const { limits } = await getWorkspaceSettings(db);
  const { prospect, research } = await researchProspect(db, initial, policy, { timeoutMs: limits.research_fetch_timeout_ms, actorId: ctx.actorId });
  const sources = buildSources(prospect, research);

  const { data: drafts } = await db
    .from("message_drafts")
    .select("id, version, body, status")
    .eq("prospect_id", prospect.id)
    .order("version", { ascending: false })
    .limit(1);
  const previous = drafts?.[0] ?? null;

  const { system, prompt } = buildMessagePrompt(brief(project), sources, {
    businessName: prospect.business_name,
    qualificationSummary: prospect.qualification_summary,
    previousDraft: previous?.body ?? null,
  });
  const { data, provider, model } = await generateStructured(db, messageOutputSchema, { system, prompt }, {
    ...ctx, projectId: project.id, operation: "generate_message",
  });
  const { kept, rejected } = enforceProvenance(data.personalization, sources);

  await db
    .from("message_drafts")
    .update({ status: "superseded" })
    .eq("prospect_id", prospect.id)
    .in("status", ["draft", "ready_for_review"]);

  const draft = check(
    await db
      .from("message_drafts")
      .insert({
        project_id: project.id,
        prospect_id: prospect.id,
        version: (previous?.version ?? 0) + 1,
        body: data.message.slice(0, 4000),
        status: "ready_for_review",
        origin: "ai",
        provider,
        model,
        metadata: { personalization: kept, discarded_personalization: rejected.length, sources: sources.map((s) => ({ ref: s.ref, label: s.label, url: s.url ?? null })) } as unknown as Json,
        created_by: ctx.actorId,
      })
      .select("*")
      .single(),
  );

  if (["new", "draft", "ready_for_review"].includes(prospect.outreach_status)) {
    await db.from("project_prospects").update({ outreach_status: "ready_for_review" }).eq("id", prospect.id);
  }
  await db.from("outreach_activities").insert({
    project_id: project.id,
    prospect_id: prospect.id,
    actor_id: ctx.actorId,
    type: "draft_generated",
    is_manual: false,
    from_status: prospect.outreach_status,
    to_status: ["new", "draft", "ready_for_review"].includes(prospect.outreach_status) ? "ready_for_review" : prospect.outreach_status,
    details: { version: draft.version, provider, model },
  });
  return draft;
}
