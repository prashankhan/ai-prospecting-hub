import { GitCompareArrows } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { MatchReview, type MatchRow } from "@/components/discover/match-review";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentProject } from "@/server/session";

export const metadata = { title: "Review matches" };

export default async function ReviewPage() {
  const { project } = await requireCurrentProject();
  const supabase = await createClient();
  const { data } = await supabase
    .from("ambiguous_matches")
    .select("id, reason, created_at, candidate, matched_identity_ids")
    .eq("project_id", project.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);
  const identityIds = [...new Set((data ?? []).flatMap((m) => m.matched_identity_ids))];
  // Only prospects in this project are visible (RLS); other projects' matches stay anonymous.
  const { data: local } = identityIds.length
    ? await supabase.from("project_prospects").select("id, identity_id, business_name, city, website, instagram_username").eq("project_id", project.id).in("identity_id", identityIds)
    : { data: [] };
  const byIdentity = new Map((local ?? []).map((p) => [p.identity_id, p]));
  const matches: MatchRow[] = (data ?? []).map((m) => ({
    id: m.id,
    reason: m.reason,
    created_at: m.created_at,
    candidate: m.candidate as MatchRow["candidate"],
    candidates: m.matched_identity_ids.map((identityId) => ({ identityId, prospect: byIdentity.get(identityId) ?? null })),
  }));
  return (
    <>
      <PageHeader title="Review matches" description={`Uncertain identities from imports and discovery in ${project.name}. Decide whether each record is a known business or a new one.`} />
      {matches.length === 0 ? (
        <EmptyState icon={GitCompareArrows} title="Nothing to review" description="When a record might be a business you already know — but the evidence isn't conclusive — it waits here instead of being merged or duplicated." />
      ) : <MatchReview matches={matches} />}
    </>
  );
}
