"use server";
import { z } from "zod";
import { isPostContact, validateTransition, TRANSITION_ERROR_MESSAGES } from "@/lib/domain/outreach";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { generateDraft, qualifyProspect } from "../agent";
import { authorize } from "../session";
import { check, run, UserFacingError, type ActionResult } from "../result";
import { getProjectPolicy } from "../settings";

const uuid = z.string().uuid();

async function loadForUser(prospectId: string) {
  const supabase = await createClient();
  const p = check(
    await supabase
      .from("project_prospects")
      .select("id, project_id, outreach_status, do_not_contact, instagram_url, instagram_match_status, last_contacted_at, qualification_status")
      .eq("id", uuid.parse(prospectId))
      .single(),
  );
  return { supabase, p };
}

export async function qualifyNow(prospectId: string): Promise<ActionResult<{ score: number; status: string }>> {
  return run(async () => {
    const { p } = await loadForUser(prospectId);
    const user = await authorize("qualification.single", p.project_id);
    const admin = createAdminClient();
    if (p.qualification_status !== "pending") {
      const policy = await getProjectPolicy(admin, p.project_id);
      if (!policy.manual_refresh_allowed) throw new UserFacingError("Re-qualification is disabled by the duplicate prevention policy.");
    }
    const r = await qualifyProspect(admin, p.id, { actorId: user.id });
    return { score: r.score, status: r.recommended_status };
  });
}

export async function generateMessage(prospectId: string): Promise<ActionResult<{ draftId: string }>> {
  return run(async () => {
    const { p } = await loadForUser(prospectId);
    const user = await authorize("drafts.generate", p.project_id);
    const draft = await generateDraft(createAdminClient(), p.id, { actorId: user.id });
    return { draftId: draft.id };
  }, "Draft generated. Review it before sending.");
}

/**
 * Saves a human edit. Edits to a draft awaiting review happen in place; editing an approved
 * message creates a new version that needs approval again (history is preserved).
 */
export async function saveDraftEdit(prospectId: string, body: string): Promise<ActionResult<{ draftId: string }>> {
  return run(async () => {
    const { supabase, p } = await loadForUser(prospectId);
    const user = await authorize("drafts.approve", p.project_id);
    const text = z.string().trim().min(1, "The message is empty").max(4000).parse(body);
    if (p.do_not_contact) throw new UserFacingError("This prospect is marked do not contact.");
    if (isPostContact(p.outreach_status)) throw new UserFacingError("This prospect was already contacted.");

    const { data: latest } = await supabase.from("message_drafts").select("id, version, status, body").eq("prospect_id", p.id).order("version", { ascending: false }).limit(1).maybeSingle();
    if (latest && latest.body === text) return { draftId: latest.id };

    if (latest && (latest.status === "draft" || latest.status === "ready_for_review")) {
      check(await supabase.from("message_drafts").update({ body: text, status: "ready_for_review" }).eq("id", latest.id).select("id").single());
      await supabase.from("outreach_activities").insert({ project_id: p.project_id, prospect_id: p.id, actor_id: user.id, type: "draft_edited", details: { version: latest.version } });
      return { draftId: latest.id };
    }
    await supabase.from("message_drafts").update({ status: "superseded" }).eq("prospect_id", p.id).in("status", ["approved", "draft", "ready_for_review"]);
    const created = check(
      await supabase.from("message_drafts").insert({
        project_id: p.project_id, prospect_id: p.id, version: (latest?.version ?? 0) + 1, body: text,
        status: "ready_for_review", origin: "manual", created_by: user.id,
      }).select("id, version").single(),
    );
    if (p.outreach_status !== "ready_for_review") {
      await supabase.from("project_prospects").update({ outreach_status: "ready_for_review" }).eq("id", p.id);
    }
    await supabase.from("outreach_activities").insert({
      project_id: p.project_id, prospect_id: p.id, actor_id: user.id, type: "draft_edited",
      from_status: p.outreach_status, to_status: "ready_for_review", details: { version: created.version, new_version: true },
    });
    return { draftId: created.id };
  }, "Message saved.");
}

export async function approveDraft(draftId: string): Promise<ActionResult> {
  return run(async () => {
    const supabase = await createClient();
    const d = check(await supabase.from("message_drafts").select("id, prospect_id, project_id, status, version").eq("id", uuid.parse(draftId)).single());
    const user = await authorize("drafts.approve", d.project_id);
    const { p } = await loadForUser(d.prospect_id);
    if (p.do_not_contact) throw new UserFacingError("This prospect is marked do not contact.");
    if (isPostContact(p.outreach_status)) throw new UserFacingError("This prospect was already contacted.");
    if (!["draft", "ready_for_review"].includes(d.status)) throw new UserFacingError("Only drafts awaiting review can be approved.");
    await supabase.from("message_drafts").update({ status: "superseded" }).eq("prospect_id", d.prospect_id).eq("status", "approved");
    check(await supabase.from("message_drafts").update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).eq("id", d.id).select("id").single());
    await supabase.from("project_prospects").update({ outreach_status: "approved" }).eq("id", d.prospect_id);
    await supabase.from("outreach_activities").insert({
      project_id: d.project_id, prospect_id: d.prospect_id, actor_id: user.id, type: "draft_approved",
      from_status: p.outreach_status, to_status: "approved", details: { version: d.version },
    });
    return undefined;
  }, "Message approved.");
}

/** Records that the profile was opened from the workspace. Never changes outreach status. */
export async function logProfileOpened(prospectId: string): Promise<ActionResult> {
  return run(async () => {
    const { supabase, p } = await loadForUser(prospectId);
    const user = await authorize("outreach.perform", p.project_id);
    await supabase.from("outreach_activities").insert({ project_id: p.project_id, prospect_id: p.id, actor_id: user.id, type: "profile_opened", is_manual: false, channel: "instagram" });
    return undefined;
  });
}

/**
 * The user explicitly confirms the approved message was sent manually. Repeat outreach is
 * additionally blocked by a database trigger.
 */
export async function markContacted(prospectId: string, draftId: string, confirmed: boolean): Promise<ActionResult> {
  return run(async () => {
    if (confirmed !== true) throw new UserFacingError("Confirm that you sent the message.");
    const { supabase, p } = await loadForUser(prospectId);
    const user = await authorize("outreach.perform", p.project_id);
    const d = check(await supabase.from("message_drafts").select("id, prospect_id, status, version").eq("id", uuid.parse(draftId)).single());
    if (d.prospect_id !== p.id || d.status !== "approved") throw new UserFacingError("Approve the message before marking it sent.");
    const v = validateTransition(p.outreach_status, "contacted", { isAdmin: user.role === "admin", hasApprovedDraft: true }, "mark_contacted");
    if (!v.ok) throw new UserFacingError(TRANSITION_ERROR_MESSAGES[v.error]);
    const { data: project } = await supabase.from("projects").select("preferred_channel").eq("id", p.project_id).single();
    const now = new Date().toISOString();
    const updated = check(
      await supabase.from("project_prospects").update({ outreach_status: "contacted", last_contacted_at: now }).eq("id", p.id).eq("outreach_status", "approved").select("id"),
    );
    if (!updated.length) throw new UserFacingError("This prospect changed in the meantime. Reload and try again.");
    await supabase.from("message_drafts").update({ status: "sent" }).eq("id", d.id);
    await supabase.from("outreach_activities").insert({
      project_id: p.project_id, prospect_id: p.id, actor_id: user.id, type: "contacted", from_status: "approved", to_status: "contacted",
      channel: project?.preferred_channel ?? "instagram", is_manual: true, details: { draft_version: d.version, confirmed_manual_send: true },
    });
    return undefined;
  }, "Marked contacted.");
}
