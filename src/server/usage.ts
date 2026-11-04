import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { UsageLimitError } from "./result";
import { getWorkspaceSettings } from "./settings";

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export async function usageToday(db: AdminClient, kind: "ai" | "discovery"): Promise<number> {
  const { data } = await db.from("usage_events").select("units").eq("kind", kind).gte("created_at", startOfUtcDay());
  return (data ?? []).reduce((n, r) => n + r.units, 0);
}

/** Throws UsageLimitError when the daily cap for the provider kind would be exceeded. */
export async function assertWithinUsage(db: AdminClient, kind: "ai" | "discovery", units = 1) {
  const { limits } = await getWorkspaceSettings(db);
  const cap = kind === "ai" ? limits.ai_daily_requests : limits.discovery_daily_requests;
  const used = await usageToday(db, kind);
  if (used + units > cap) {
    throw new UsageLimitError(
      `Daily ${kind === "ai" ? "AI" : "discovery"} request limit reached (${used}/${cap}). An administrator can raise it in Settings → ${kind === "ai" ? "AI providers" : "Discovery providers"}.`,
    );
  }
}

export async function recordUsage(
  db: AdminClient,
  e: { kind: "ai" | "discovery"; provider: string; operation: string; projectId?: string | null; userId?: string | null; jobId?: string | null; success: boolean; units?: number },
) {
  await db.from("usage_events").insert({
    kind: e.kind,
    provider: e.provider,
    operation: e.operation,
    units: e.units ?? 1,
    project_id: e.projectId ?? null,
    user_id: e.userId ?? null,
    job_id: e.jobId ?? null,
    success: e.success,
  });
}
