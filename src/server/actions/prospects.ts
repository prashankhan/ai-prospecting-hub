"use server";
import Papa from "papaparse";
import { z } from "zod";
import { mergeEvidence, classifyInstagram, type InstagramEvidence } from "@/lib/identity/candidate";
import { instagramProfileUrl, normalizeInstagramUsername } from "@/lib/identity/normalize";
import {
  OUTREACH_STATUSES, RESPONSE_STATUSES, TRANSITION_ERROR_MESSAGES, validateTransition, type OutreachStatus,
} from "@/lib/domain/outreach";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { IMPORT_FIELDS } from "@/lib/csv/import";
import { authorize } from "../session";
import { check, run, toErrorMessage, UserFacingError, type ActionResult } from "../result";
import { ingestRaw } from "../jobs";
import { getProjectPolicy, logAudit } from "../settings";

const id = z.string().uuid();
const ids = z.array(id).min(1).max(500);

async function projectOf(prospectId: string) {
  const supabase = await createClient();
  const row = check(await supabase.from("project_prospects").select("id, project_id").eq("id", id.parse(prospectId)).single());
  return row.project_id;
}

async function projectOfMany(prospectIds: string[]) {
  const supabase = await createClient();
  const rows = check(await supabase.from("project_prospects").select("id, project_id").in("id", ids.parse(prospectIds)));
  const projects = [...new Set(rows.map((r) => r.project_id))];
  if (projects.length !== 1 || rows.length !== prospectIds.length) throw new UserFacingError("Selected prospects must belong to one accessible project.");
  return projects[0];
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------
const editSchema = z.object({
  business_name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(120).nullable(),
  country: z.string().trim().max(80).nullable(),
  city: z.string().trim().max(120).nullable(),
  address: z.string().trim().max(300).nullable(),
  website: z.string().trim().max(500).nullable(),
  phone: z.string().trim().max(40).nullable(),
  email: z.string().trim().email().max(200).nullable().or(z.literal("").transform(() => null)),
});

export async function updateProspectDetails(prospectId: string, input: z.input<typeof editSchema>): Promise<ActionResult> {
  return run(async () => {
    const projectId = await projectOf(prospectId);
    const user = await authorize("prospects.edit", projectId);
    const data = editSchema.parse(input);
    const supabase = await createClient();
    check(await supabase.from("project_prospects").update(data).eq("id", prospectId).select("id").single());
    await logAudit(createAdminClient(), { actorId: user.id, projectId, action: "prospect.edit", entityType: "project_prospect", entityId: prospectId });
    return undefined;
  }, "Prospect updated.");
}

/** A person confirms (or corrects) the Instagram profile. Recorded as manual evidence. */
export async function verifyInstagram(prospectId: string, handle: string): Promise<ActionResult> {
  return run(async () => {
    const projectId = await projectOf(prospectId);
    const user = await authorize("prospects.edit", projectId);
    const username = normalizeInstagramUsername(handle);
    if (!username) throw new UserFacingError("Enter a valid Instagram username or profile URL.");
    const supabase = await createClient();
    const p = check(await supabase.from("project_prospects").select("instagram_evidence").eq("id", prospectId).single());
    const evidence = mergeEvidence((p.instagram_evidence as unknown as InstagramEvidence[]) ?? [], [{
      username, source: "manual", url: instagramProfileUrl(username), detail: "Verified manually by a team member", observed_at: new Date().toISOString(), actor_id: user.id,
    }]);
    const ig = classifyInstagram(evidence, true);
    check(await supabase.from("project_prospects").update({
      instagram_username: ig.username, instagram_url: ig.username ? instagramProfileUrl(ig.username) : null,
      instagram_match_status: ig.status, instagram_evidence: evidence as unknown as Json,
    }).eq("id", prospectId).select("id").single());
    await supabase.from("outreach_activities").insert({ project_id: projectId, prospect_id: prospectId, actor_id: user.id, type: "instagram_verified", details: { username } });
    return undefined;
  }, "Instagram profile verified.");
}

export async function addNote(prospectId: string, body: string): Promise<ActionResult> {
  return run(async () => {
    const projectId = await projectOf(prospectId);
    const user = await authorize("prospects.note", projectId);
    const text = z.string().trim().min(1, "Write a note first").max(5000).parse(body);
    const supabase = await createClient();
    check(await supabase.from("prospect_notes").insert({ project_id: projectId, prospect_id: prospectId, author_id: user.id, body: text }).select("id").single());
    return undefined;
  }, "Note added.");
}

// ---------------------------------------------------------------------------
// Assignment & status
// ---------------------------------------------------------------------------
export async function assignProspects(prospectIds: string[], userId: string | null): Promise<ActionResult<{ count: number }>> {
  return run(async () => {
    const projectId = await projectOfMany(prospectIds);
    const actor = await authorize("prospects.assign", projectId);
    const supabase = await createClient();
    if (userId) {
      const admin = createAdminClient();
      const { data: profile } = await admin.from("profiles").select("app_role, status").eq("id", id.parse(userId)).single();
      const { data: member } = await admin.from("project_members").select("user_id").eq("project_id", projectId).eq("user_id", userId).maybeSingle();
      if (!profile || profile.status !== "active" || (profile.app_role !== "admin" && !member)) {
        throw new UserFacingError("That person doesn't have access to this project.");
      }
    }
    const rows = check(await supabase.from("project_prospects").update({ assigned_to: userId }).in("id", prospectIds).select("id"));
    await supabase.from("outreach_activities").insert(
      rows.map((r) => ({ project_id: projectId, prospect_id: r.id, actor_id: actor.id, type: "assignment", details: { assigned_to: userId } })),
    );
    return { count: rows.length };
  }, "Assignment updated.");
}

const statusSchema = z.enum(OUTREACH_STATUSES);

/** Generic status change (responses, outcomes). Contacting and DNC use dedicated actions. */
export async function changeStatus(prospectIds: string[], to: OutreachStatus, note?: string): Promise<ActionResult<{ updated: number; skipped: number }>> {
  return run(async () => {
    const projectId = await projectOfMany(prospectIds);
    const user = await authorize("outreach.status", projectId);
    const target = statusSchema.parse(to);
    const supabase = await createClient();
    const rows = check(await supabase.from("project_prospects").select("id, outreach_status").in("id", prospectIds));
    const approvedDrafts = new Set(
      check(await supabase.from("message_drafts").select("prospect_id").in("prospect_id", prospectIds).eq("status", "approved")).map((d) => d.prospect_id),
    );
    let updated = 0;
    let lastError: string | null = null;
    for (const r of rows) {
      const v = validateTransition(r.outreach_status, target, { isAdmin: user.role === "admin", hasApprovedDraft: approvedDrafts.has(r.id) });
      if (!v.ok) {
        lastError = TRANSITION_ERROR_MESSAGES[v.error];
        continue;
      }
      const isResponse = RESPONSE_STATUSES.includes(target);
      const res = await supabase
        .from("project_prospects")
        .update({
          outreach_status: target,
          ...(isResponse ? { last_response_at: new Date().toISOString() } : {}),
          ...(r.outreach_status === "do_not_contact" ? { do_not_contact: false } : {}),
        })
        .eq("id", r.id)
        .eq("outreach_status", r.outreach_status) // optimistic concurrency
        .select("id");
      if (res.error) {
        lastError = toErrorMessage(res.error);
        continue;
      }
      if (!res.data?.length) continue;
      updated++;
      if (r.outreach_status === "do_not_contact") {
        // Lifting DNC (admin only, validated above) also removes the suppression records.
        const admin = createAdminClient();
        const { data: p } = await admin.from("project_prospects").select("identity_id").eq("id", r.id).single();
        if (p) {
          await admin.from("suppression_records").delete().eq("identity_id", p.identity_id).or(`project_id.is.null,project_id.eq.${projectId}`);
          await logAudit(admin, { actorId: user.id, projectId, action: "prospect.lift_do_not_contact", entityType: "project_prospect", entityId: r.id });
        }
      }
      await supabase.from("outreach_activities").insert({
        project_id: projectId, prospect_id: r.id, actor_id: user.id,
        type: isResponse && !RESPONSE_STATUSES.includes(r.outreach_status) ? "response_recorded" : "status_change",
        from_status: r.outreach_status, to_status: target, is_manual: true, details: note ? { note: note.slice(0, 1000) } : {},
      });
    }
    if (updated === 0 && lastError) throw new UserFacingError(lastError);
    return { updated, skipped: rows.length - updated };
  });
}

export async function markDoNotContact(prospectIds: string[], reason: string, global: boolean): Promise<ActionResult<{ count: number }>> {
  return run(async () => {
    const projectId = await projectOfMany(prospectIds);
    const user = await authorize("dnc.set", projectId);
    const why = z.string().trim().max(500).parse(reason);
    const admin = createAdminClient();
    for (const pid of prospectIds) {
      const { error } = await admin.rpc("set_do_not_contact", { p_prospect_id: pid, p_reason: why, p_global: global, p_actor: user.id });
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
    }
    await logAudit(admin, { actorId: user.id, projectId, action: "prospect.do_not_contact", details: { count: prospectIds.length, global, reason: why } });
    return { count: prospectIds.length };
  }, "Marked do not contact.");
}

export async function deleteProspects(prospectIds: string[]): Promise<ActionResult<{ count: number }>> {
  return run(async () => {
    const projectId = await projectOfMany(prospectIds);
    const user = await authorize("prospects.delete", projectId);
    const supabase = await createClient();
    const rows = check(await supabase.from("project_prospects").delete().in("id", prospectIds).select("id"));
    await logAudit(createAdminClient(), { actorId: user.id, projectId, action: "prospect.delete", details: { count: rows.length } });
    return { count: rows.length };
  }, "Prospects deleted.");
}

// ---------------------------------------------------------------------------
// CSV import (synchronous, bounded; every row goes through database duplicate checks)
// ---------------------------------------------------------------------------
const MAX_ROWS = 1000;
const MAX_BYTES = 2 * 1024 * 1024;
const mappingSchema = z.record(z.enum(IMPORT_FIELDS), z.string().max(200).optional());

export interface ImportSummary {
  jobId: string;
  total: number;
  new: number;
  known: number;
  skipped: number;
  ambiguous: number;
  failed: number;
  errors: { row: number; message: string }[];
}

export async function importCsv(projectId: string, form: FormData): Promise<ActionResult<ImportSummary>> {
  return run(async () => {
    const user = await authorize("prospects.import", id.parse(projectId));
    const file = form.get("file");
    if (!(file instanceof File)) throw new UserFacingError("Choose a CSV file.");
    if (file.size > MAX_BYTES) throw new UserFacingError("The file is larger than 2 MB.");
    if (!/\.csv$/i.test(file.name) && !/csv|text\/plain/.test(file.type)) throw new UserFacingError("Only .csv files are supported.");
    const mapping = mappingSchema.parse(JSON.parse(String(form.get("mapping") ?? "{}")));
    if (!mapping.business_name) throw new UserFacingError("Map a column to Business name.");

    const text = (await file.text()).replace(/^﻿/, "");
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    const rows = parsed.data.slice(0, MAX_ROWS + 1);
    if (rows.length > MAX_ROWS) throw new UserFacingError(`The file has more than ${MAX_ROWS} rows. Split it into smaller files.`);
    if (rows.length === 0) throw new UserFacingError("The file has no data rows.");

    const supabase = await createClient();
    const job = check(
      await supabase.from("jobs").insert({
        project_id: projectId, type: "discovery", provider: "csv", status: "queued", created_by: user.id,
        params: { source: "csv", file_name: file.name.slice(0, 200), rows: rows.length } as Json,
        total: rows.length,
      }).select("id").single(),
    );
    const admin = createAdminClient();
    await admin.from("jobs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", job.id);

    const summary: ImportSummary = { jobId: job.id, total: rows.length, new: 0, known: 0, skipped: 0, ambiguous: 0, failed: 0, errors: [] };
    const cell = (row: Record<string, string>, f: (typeof IMPORT_FIELDS)[number]) => {
      const col = mapping[f];
      const v = col ? row[col] : undefined;
      return typeof v === "string" ? v.trim().slice(0, 500) || null : null;
    };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = cell(row, "business_name");
      try {
        if (!name) throw new UserFacingError("Missing business name");
        const res = await ingestRaw(admin, projectId, {
          business_name: name, category: cell(row, "category"), country: cell(row, "country"), city: cell(row, "city"),
          address: cell(row, "address"), website: cell(row, "website"), phone: cell(row, "phone"), email: cell(row, "email"),
          instagram: cell(row, "instagram"), instagram_source: "csv", source: "csv", source_ref: `${file.name.slice(0, 100)}#${i + 2}`,
          source_data: { file: file.name.slice(0, 200), row: i + 2 },
        }, job.id, user.id);
        if (res.outcome === "new") summary.new++;
        else if (res.outcome === "known_added" || res.outcome === "updated") summary.known++;
        else if (res.outcome === "ambiguous") summary.ambiguous++;
        else summary.skipped++;
        await admin.from("job_events").insert({ job_id: job.id, project_id: projectId, outcome: res.outcome, record_ref: name, data: { row: i + 2, prospect_id: res.prospect_id, ambiguous_id: res.ambiguous_id } });
      } catch (err) {
        summary.failed++;
        const message = toErrorMessage(err);
        if (summary.errors.length < 20) summary.errors.push({ row: i + 2, message });
        await admin.from("job_events").insert({ job_id: job.id, project_id: projectId, outcome: "failed", record_ref: name ?? `Row ${i + 2}`, message });
      }
    }
    const { data: j } = await admin.from("jobs").select("processed").eq("id", job.id).single();
    await admin.from("jobs").update({
      status: "completed", finished_at: new Date().toISOString(), failed_count: summary.failed,
      processed: (j?.processed ?? 0) + summary.failed,
    }).eq("id", job.id);
    await logAudit(admin, { actorId: user.id, projectId, action: "prospect.import_csv", entityType: "job", entityId: job.id, details: { ...summary, errors: undefined } });
    return summary;
  });
}

/** Policy-aware manual refresh: re-research and re-qualify a single prospect now. */
export async function refreshProspect(prospectId: string): Promise<ActionResult> {
  return run(async () => {
    const projectId = await projectOf(prospectId);
    const user = await authorize("qualification.single", projectId);
    const admin = createAdminClient();
    const policy = await getProjectPolicy(admin, projectId);
    if (!policy.manual_refresh_allowed) throw new UserFacingError("Manual refresh is disabled by the duplicate prevention policy.");
    const { qualifyProspect } = await import("../agent");
    await qualifyProspect(admin, prospectId, { actorId: user.id, forceResearch: true });
    await createAdminClient().from("outreach_activities").insert({ project_id: projectId, prospect_id: prospectId, actor_id: user.id, type: "refreshed", is_manual: true });
    return undefined;
  }, "Research refreshed and prospect re-qualified.");
}
