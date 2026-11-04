import "server-only";
import { buildCandidate, ingestResultSchema, type RawCandidate } from "@/lib/identity/candidate";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

/** Runs `ingest_prospect_candidate` for one raw record. Shared by discovery and CSV import. */
export async function ingestRaw(db: AdminClient, projectId: string, raw: RawCandidate, jobId: string | null, actorId: string | null) {
  const candidate = buildCandidate(raw);
  const { data, error } = await db.rpc("ingest_prospect_candidate", {
    p_project_id: projectId,
    p_candidate: candidate as unknown as Json,
    p_job_id: jobId ?? undefined,
    p_actor: actorId ?? undefined,
  });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return ingestResultSchema.parse(data);
}

