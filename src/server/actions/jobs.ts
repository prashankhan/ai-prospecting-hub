"use server";
import { after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { discoveryParamsSchema, registerJobWorker, runJobTick } from "../jobs";
import { authorize } from "../session";
import { check, run, UserFacingError, type ActionResult } from "../result";
import { getProjectPolicy, getWorkspaceSettings, logAudit } from "../settings";
import { usageToday } from "../usage";

const uuid = z.string().uuid();

/**
 * Starts work right after the response is sent and keeps advancing the job for up to ~50 s,
 * so small jobs finish without any scheduler. Longer jobs continue via the Supabase pg_cron
 * worker (registered here), the open job page, and the daily Vercel cron sweep.
 */
function kickOff(jobId: string) {
  after(async () => {
    const db = createAdminClient();
    await registerJobWorker(db);
    const deadline = Date.now() + 50_000;
    try {
      while (Date.now() < deadline - 5_000) {
        const res = await runJobTick(db, { jobId, budgetMs: Math.min(30_000, deadline - Date.now() - 5_000) });
        if (!res.claimed || res.status !== "running") break;
      }
    } catch (err) {
      console.error("[jobs] background tick failed", err instanceof Error ? err.message : err);
    }
  });
}

export async function startDiscovery(projectId: string, input: z.input<typeof discoveryParamsSchema>): Promise<ActionResult<{ jobId: string }>> {
  return run(async () => {
    const user = await authorize("discovery.run", uuid.parse(projectId));
    const params = discoveryParamsSchema.parse(input);
    const admin = createAdminClient();
    const { limits } = await getWorkspaceSettings(admin);
    if (params.max_results > limits.discovery_max_results_per_job) {
      throw new UserFacingError(`The result limit can't exceed ${limits.discovery_max_results_per_job} (Settings → Discovery providers).`);
    }
    const pages = Math.ceil(params.max_results / 20);
    const used = await usageToday(admin, "discovery");
    if (used + pages > limits.discovery_daily_requests) {
      throw new UserFacingError(`This search needs up to ${pages} requests but only ${Math.max(0, limits.discovery_daily_requests - used)} remain today.`);
    }
    const { data: cfg } = await admin.from("provider_configs").select("is_enabled, encrypted_secret").eq("kind", "discovery").eq("provider", params.provider).maybeSingle();
    if (!cfg?.is_enabled || !cfg.encrypted_secret) throw new UserFacingError("Google Places isn't configured. Add a key in Settings → Discovery providers.");

    const supabase = await createClient();
    const job = check(
      await supabase.from("jobs").insert({
        project_id: projectId, type: "discovery", provider: params.provider, params: params as unknown as Json,
        total: params.max_results, created_by: user.id, status: "queued",
      }).select("id").single(),
    );
    await logAudit(admin, { actorId: user.id, projectId, action: "discovery.start", entityType: "job", entityId: job.id, details: params });
    kickOff(job.id);
    return { jobId: job.id };
  }, "Discovery started.");
}

export async function startBatchJob(projectId: string, type: "qualification" | "message_generation", prospectIds: string[]): Promise<ActionResult<{ jobId: string; queued: number; excluded: number }>> {
  return run(async () => {
    const user = await authorize("qualification.bulk", uuid.parse(projectId));
    const ids = z.array(uuid).min(1).max(500).parse(prospectIds);
    const admin = createAdminClient();
    const [{ limits }, policy] = await Promise.all([getWorkspaceSettings(admin), getProjectPolicy(admin, projectId)]);
    if (ids.length > limits.ai_batch_size) {
      throw new UserFacingError(`Select at most ${limits.ai_batch_size} prospects per batch (Settings → AI providers → Bulk AI batch limit).`);
    }
    const supabase = await createClient();
    const rows = check(await supabase.from("project_prospects").select("id, qualification_status, do_not_contact, outreach_status").eq("project_id", projectId).in("id", ids));
    const eligible = rows.filter((r) => {
      if (r.do_not_contact) return false;
      if (type === "qualification") return policy.automatic_reprocessing || r.qualification_status === "pending";
      return ["new", "draft", "ready_for_review", "approved"].includes(r.outreach_status);
    });
    if (eligible.length === 0) {
      throw new UserFacingError(type === "qualification"
        ? "All selected prospects were already assessed. Enable automatic reprocessing, or refresh prospects individually."
        : "None of the selected prospects are eligible for a new message.");
    }
    const { count: activeAI } = await admin.from("provider_configs").select("id", { count: "exact", head: true }).eq("kind", "ai").eq("is_default", true).eq("is_enabled", true);
    if (!activeAI) throw new UserFacingError("Configure a default AI provider in Settings → AI providers first.");
    const job = check(
      await supabase.from("jobs").insert({
        project_id: projectId, type, params: { prospect_ids: eligible.map((r) => r.id) }, total: eligible.length, created_by: user.id, status: "queued",
      }).select("id").single(),
    );
    await logAudit(admin, { actorId: user.id, projectId, action: `${type}.start`, entityType: "job", entityId: job.id, details: { count: eligible.length } });
    kickOff(job.id);
    return { jobId: job.id, queued: eligible.length, excluded: rows.length - eligible.length };
  }, "Job started.");
}

export async function cancelJob(jobId: string): Promise<ActionResult> {
  return run(async () => {
    const supabase = await createClient();
    const job = check(await supabase.from("jobs").select("id, project_id, status").eq("id", uuid.parse(jobId)).single());
    const user = await authorize("discovery.run", job.project_id);
    if (!["queued", "running"].includes(job.status)) throw new UserFacingError("This job is no longer running.");
    const admin = createAdminClient();
    await admin.from("jobs").update({ cancel_requested: true }).eq("id", job.id);
    // A queued job with no active lease can be cancelled immediately.
    await admin.from("jobs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", job.id).eq("status", "queued").is("lease_token", null);
    await logAudit(admin, { actorId: user.id, projectId: job.project_id, action: "job.cancel", entityType: "job", entityId: job.id });
    return undefined;
  }, "Cancellation requested.");
}

/** Advances a job the caller can see. Used by the progress view while it is open. */
export async function advanceJob(jobId: string): Promise<ActionResult<{ status: string }>> {
  return run(async () => {
    const supabase = await createClient();
    const job = check(await supabase.from("jobs").select("id, project_id, status").eq("id", uuid.parse(jobId)).single());
    await authorize("outreach.perform", job.project_id);
    if (!["queued", "running"].includes(job.status)) return { status: job.status };
    const res = await runJobTick(createAdminClient(), { jobId: job.id, budgetMs: 20_000 });
    return { status: res.claimed ? res.status : job.status };
  });
}

export async function resolveAmbiguousMatch(matchId: string, resolution: "separate" | "existing" | "dismiss", identityId?: string): Promise<ActionResult> {
  return run(async () => {
    const supabase = await createClient();
    const match = check(await supabase.from("ambiguous_matches").select("id, project_id").eq("id", uuid.parse(matchId)).single());
    const user = await authorize("matches.resolve", match.project_id);
    const admin = createAdminClient();
    const { error } = await admin.rpc("resolve_ambiguous_match", {
      p_match_id: match.id, p_resolution: z.enum(["separate", "existing", "dismiss"]).parse(resolution),
      p_identity_id: identityId ? uuid.parse(identityId) : undefined, p_actor: user.id,
    });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return undefined;
  }, "Match resolved.");
}
