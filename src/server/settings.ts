import "server-only";
import { effectivePolicy, parseUsageLimits, type DuplicatePolicy, type UsageLimits } from "@/lib/domain/policy";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

type AnyClient = AdminClient | ServerClient;

export async function getWorkspaceSettings(db: AnyClient): Promise<{ policy: DuplicatePolicy; limits: UsageLimits }> {
  const { data } = await db.from("app_settings").select("duplicate_policy, usage_limits").eq("id", true).maybeSingle();
  return { policy: effectivePolicy(data?.duplicate_policy ?? {}, {}), limits: parseUsageLimits(data?.usage_limits ?? {}) };
}

export async function getProjectPolicy(db: AnyClient, projectId: string): Promise<DuplicatePolicy> {
  const [{ data: settings }, { data: project }] = await Promise.all([
    db.from("app_settings").select("duplicate_policy").eq("id", true).maybeSingle(),
    db.from("projects").select("duplicate_policy_overrides").eq("id", projectId).maybeSingle(),
  ]);
  return effectivePolicy(settings?.duplicate_policy ?? {}, project?.duplicate_policy_overrides ?? {});
}

export async function logAudit(
  db: AdminClient,
  entry: { actorId: string | null; projectId?: string | null; action: string; entityType?: string; entityId?: string; details?: Record<string, unknown> },
) {
  await db.from("audit_logs").insert({
    actor_id: entry.actorId,
    project_id: entry.projectId ?? null,
    action: entry.action,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    details: (entry.details ?? {}) as Json,
  });
}
