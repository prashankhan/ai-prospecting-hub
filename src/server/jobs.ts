import "server-only";
import { z } from "zod";
import { ProviderError } from "@/lib/ai/types";
import { ingestRaw } from "./ingest";
import { webDiscoveryParamsSchema, webDiscoveryStep } from "./web-discovery";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json, Tables } from "@/lib/supabase/database.types";
import { generateDraft, qualifyProspect } from "./agent";
import { getDiscoveryCredentials } from "./providers";
import { check, toErrorMessage, UsageLimitError } from "./result";
import { getWorkspaceSettings } from "./settings";
import { assertWithinUsage, recordUsage } from "./usage";
import { serverEnv } from "@/lib/env";

type Job = Tables<"jobs">;

export const discoveryParamsSchema = z.object({
  provider: z.literal("google_places"),
  query: z.object({
    keywords: z.string().trim().min(2).max(200),
    industry: z.string().trim().max(120).optional(),
    country: z.string().trim().max(80).optional(),
    city: z.string().trim().max(120).optional(),
    exclusions: z.array(z.string().trim().min(1).max(60)).max(30),
  }),
  max_results: z.number().int().min(1).max(500),
  auto_qualify: z.boolean(),
});
export type DiscoveryParams = z.infer<typeof discoveryParamsSchema>;

export const batchParamsSchema = z.object({
  prospect_ids: z.array(z.string().uuid()).min(1).max(500),
  force_research: z.boolean().optional(),
  /** Qualification jobs: queue message generation for prospects that end up qualified. */
  then_generate: z.boolean().optional(),
});

const LEASE_SECONDS = 120;
const PER_TICK_AI_ITEMS = 4;

/** Errors that will fail every remaining record, so the job stops instead of burning retries. */
function isFatal(err: unknown) {
  if (err instanceof UsageLimitError) return true;
  if (err instanceof ProviderError) return ["auth", "permission", "quota", "not_configured", "not_found"].includes(err.code);
  return false;
}

async function event(db: AdminClient, job: Job, outcome: string, recordRef: string | null, message: string | null, data: Record<string, unknown> = {}) {
  await db.from("job_events").insert({ job_id: job.id, project_id: job.project_id, outcome, record_ref: recordRef, message, data: data as Json });
}

async function bump(db: AdminClient, jobId: string, fields: Partial<Record<"processed" | "failed_count" | "skipped_count", number>>) {
  const { data } = await db.from("jobs").select("processed, failed_count, skipped_count").eq("id", jobId).single();
  if (!data) return;
  await db
    .from("jobs")
    .update({
      processed: data.processed + (fields.processed ?? 0),
      failed_count: data.failed_count + (fields.failed_count ?? 0),
      skipped_count: data.skipped_count + (fields.skipped_count ?? 0),
    })
    .eq("id", jobId);
}

export { ingestRaw } from "./ingest";

interface StepOutcome {
  done: boolean;
  cursor: Record<string, unknown>;
  total?: number;
}

async function discoveryStep(db: AdminClient, job: Job): Promise<StepOutcome> {
  const params = discoveryParamsSchema.parse(job.params);
  const cursor = (job.cursor ?? {}) as { page_token?: string | null; fetched?: number; pages?: number };
  const fetched = cursor.fetched ?? 0;
  const remaining = params.max_results - fetched;
  if (remaining <= 0) return { done: true, cursor };

  await assertWithinUsage(db, "discovery");
  const { apiKey, adapter } = await getDiscoveryCredentials(db, params.provider);
  let page;
  try {
    page = await adapter.searchPage(apiKey, params.query, { pageToken: cursor.page_token, pageSize: Math.min(20, remaining) });
    await recordUsage(db, { kind: "discovery", provider: params.provider, operation: "text_search", projectId: job.project_id, userId: job.created_by, jobId: job.id, success: true });
  } catch (err) {
    await recordUsage(db, { kind: "discovery", provider: params.provider, operation: "text_search", projectId: job.project_id, userId: job.created_by, jobId: job.id, success: false });
    throw err;
  }

  for (const ex of page.excluded) {
    await event(db, job, "excluded", ex.name, ex.reason);
  }
  if (page.excluded.length) await bump(db, job.id, { processed: page.excluded.length, skipped_count: page.excluded.length });

  for (const raw of page.candidates.slice(0, remaining)) {
    try {
      const res = await ingestRaw(db, job.project_id, raw, job.id, job.created_by);
      await event(db, job, res.outcome, raw.business_name, null, { prospect_id: res.prospect_id, ambiguous_id: res.ambiguous_id });
    } catch (err) {
      await event(db, job, "failed", raw.business_name, toErrorMessage(err));
      await bump(db, job.id, { processed: 1, failed_count: 1 });
    }
  }

  const newFetched = fetched + page.candidates.length + page.excluded.length;
  const done = !page.nextPageToken || newFetched >= params.max_results || page.candidates.length + page.excluded.length === 0;
  return {
    done,
    cursor: { page_token: page.nextPageToken, fetched: newFetched, pages: (cursor.pages ?? 0) + 1 },
    total: done ? newFetched : Math.min(params.max_results, newFetched + 20),
  };
}

async function batchStep(db: AdminClient, job: Job, deadline: number): Promise<StepOutcome> {
  const params = batchParamsSchema.parse(job.params);
  const cursor = (job.cursor ?? {}) as { index?: number };
  let index = cursor.index ?? 0;
  let handled = 0;
  while (index < params.prospect_ids.length && handled < PER_TICK_AI_ITEMS && Date.now() < deadline) {
    const prospectId = params.prospect_ids[index];
    const { data: fresh } = await db.from("jobs").select("cancel_requested").eq("id", job.id).single();
    if (fresh?.cancel_requested) break;
    try {
      if (job.type === "qualification") {
        await qualifyProspect(db, prospectId, { actorId: job.created_by, jobId: job.id, forceResearch: params.force_research });
      } else {
        await generateDraft(db, prospectId, { actorId: job.created_by, jobId: job.id });
      }
      await event(db, job, "processed", prospectId, null, { prospect_id: prospectId });
      await bump(db, job.id, { processed: 1 });
    } catch (err) {
      if (isFatal(err)) throw err;
      await event(db, job, "failed", prospectId, toErrorMessage(err), { prospect_id: prospectId });
      await bump(db, job.id, { processed: 1, failed_count: 1 });
    }
    index++;
    handled++;
  }
  return { done: index >= params.prospect_ids.length, cursor: { index }, total: params.prospect_ids.length };
}

async function finish(db: AdminClient, job: Job, status: "completed" | "failed" | "cancelled", lastError: string | null = null) {
  await db
    .from("jobs")
    .update({ status, finished_at: new Date().toISOString(), lease_expires_at: null, lease_token: null, last_error: lastError })
    .eq("id", job.id)
    .eq("lease_token", job.lease_token!);
}

async function onQualificationComplete(db: AdminClient, job: Job) {
  const params = batchParamsSchema.safeParse(job.params);
  if (!params.success || !params.data.then_generate) return;
  const { data } = await db
    .from("project_prospects")
    .select("id")
    .in("id", params.data.prospect_ids)
    .eq("qualification_status", "qualified")
    .eq("do_not_contact", false)
    .in("outreach_status", ["new", "draft"]);
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length === 0) return;
  await db.from("jobs").insert({ project_id: job.project_id, type: "message_generation", params: { prospect_ids: ids }, total: ids.length, created_by: job.created_by });
}

async function onDiscoveryComplete(db: AdminClient, job: Job) {
  const web = webDiscoveryParamsSchema.safeParse(job.params);
  const places = discoveryParamsSchema.safeParse(job.params);
  const autoQualify = web.success ? web.data.auto_qualify : places.success && places.data.auto_qualify;
  const thenGenerate = web.success && web.data.auto_generate;
  if (!autoQualify) return;
  const { data } = await db
    .from("project_prospects")
    .select("id")
    .eq("discovery_job_id", job.id)
    .eq("qualification_status", "pending")
    .limit(500);
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length === 0) return;
  await db.from("jobs").insert({
    project_id: job.project_id,
    type: "qualification",
    params: { prospect_ids: ids, ...(thenGenerate ? { then_generate: true } : {}) },
    total: ids.length,
    created_by: job.created_by,
  });
}

/**
 * Claims one runnable job (optionally a specific one), advances it by a bounded amount of
 * work, and releases the lease. Safe to call from cron, from the progress UI, or after().
 */
export async function runJobTick(db: AdminClient, opts: { jobId?: string; budgetMs?: number } = {}) {
  const { limits } = await getWorkspaceSettings(db);
  const { data: claimed, error } = await db.rpc("claim_job", {
    p_job_id: opts.jobId,
    p_lease_seconds: LEASE_SECONDS,
    p_max_concurrent: limits.max_concurrent_jobs,
  });
  if (error) throw new Error(error.message);
  const job = claimed?.[0];
  if (!job) return { claimed: false as const };

  if (job.cancel_requested) {
    await finish(db, job, "cancelled");
    return { claimed: true as const, jobId: job.id, status: "cancelled" };
  }

  const deadline = Date.now() + (opts.budgetMs ?? 40_000);
  try {
    const isWeb = job.type === "discovery" && webDiscoveryParamsSchema.safeParse(job.params).success;
    const step = isWeb
      ? await webDiscoveryStep(db, job, deadline)
      : job.type === "discovery" ? await discoveryStep(db, job) : await batchStep(db, job, deadline);
    const { data: fresh } = await db.from("jobs").select("cancel_requested").eq("id", job.id).single();
    const patch = { cursor: step.cursor as Json, ...(step.total !== undefined ? { total: step.total } : {}), attempts: 0 };
    if (fresh?.cancel_requested) {
      await db.from("jobs").update(patch).eq("id", job.id);
      await finish(db, job, "cancelled");
      return { claimed: true as const, jobId: job.id, status: "cancelled" };
    }
    if (step.done) {
      await db.from("jobs").update(patch).eq("id", job.id);
      await finish(db, job, "completed");
      if (job.type === "discovery") await onDiscoveryComplete(db, job);
      if (job.type === "qualification") await onQualificationComplete(db, job);
      return { claimed: true as const, jobId: job.id, status: "completed" };
    }
    check(
      await db.from("jobs").update({ ...patch, lease_expires_at: null, lease_token: null }).eq("id", job.id).eq("lease_token", job.lease_token!).select("id"),
    );
    return { claimed: true as const, jobId: job.id, status: "running" };
  } catch (err) {
    const message = toErrorMessage(err);
    const attempts = job.attempts + 1;
    if (isFatal(err) || attempts >= job.max_attempts) {
      await event(db, job, "job_failed", null, message);
      await db.from("jobs").update({ attempts }).eq("id", job.id);
      await finish(db, job, "failed", message);
      return { claimed: true as const, jobId: job.id, status: "failed" };
    }
    // Bounded retry: release the lease with a short back-off.
    await db
      .from("jobs")
      .update({ attempts, last_error: message, lease_token: null, lease_expires_at: new Date(Date.now() + 15_000 * attempts).toISOString() })
      .eq("id", job.id)
      .eq("lease_token", job.lease_token!);
    return { claimed: true as const, jobId: job.id, status: "retrying" };
  }
}

/**
 * Keeps the database scheduler (supabase/migrations/…06_job_worker_scheduler.sql) pointed at
 * this deployment. No-op for local/non-https URLs or when CRON_SECRET is missing.
 */
export async function registerJobWorker(db: AdminClient): Promise<boolean> {
  const { appUrl, cronSecret } = serverEnv();
  if (!/^https:\/\/[a-z0-9.-]+(:[0-9]+)?$/i.test(appUrl) || cronSecret.length < 16) return false;
  const { data, error } = await db.rpc("register_job_worker", { p_app_url: appUrl.toLowerCase(), p_secret: cronSecret });
  if (error) {
    console.error("[jobs] could not register the database job worker:", error.message);
    return false;
  }
  return data === true;
}
