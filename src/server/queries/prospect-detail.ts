import "server-only";
import type { ServerClient } from "@/lib/supabase/server";
import type { Activity, Draft, Note, ProspectFull, Qualification } from "@/components/prospects/types";

export interface ProspectBundle {
  prospect: ProspectFull;
  drafts: Draft[];
  qualification: Qualification | null;
  notes: Note[];
  activities: Activity[];
  research: { id: string; source_url: string; title: string | null; error: string | null; fetched_at: string; http_status: number | null }[];
  names: Record<string, string>;
}

export async function loadProspectBundle(supabase: ServerClient, prospectId: string): Promise<ProspectBundle | null> {
  const { data: prospect } = await supabase.from("project_prospects").select("*").eq("id", prospectId).maybeSingle();
  if (!prospect) return null;
  const [drafts, qual, notes, activities, research] = await Promise.all([
    supabase.from("message_drafts").select("id, version, body, status, origin, provider, model, metadata, created_at, approved_at, created_by").eq("prospect_id", prospectId).order("version", { ascending: false }),
    supabase.from("qualification_results").select("id, score, recommended_status, explanation, evidence, source_refs, missing_information, researched_at, provider, model, created_at").eq("prospect_id", prospectId).order("created_at", { ascending: false }).limit(1),
    supabase.from("prospect_notes").select("id, body, created_at, author_id").eq("prospect_id", prospectId).order("created_at", { ascending: false }).limit(100),
    supabase.from("outreach_activities").select("id, type, from_status, to_status, is_manual, details, created_at, actor_id").eq("prospect_id", prospectId).order("created_at", { ascending: false }).limit(100),
    supabase.from("research_results").select("id, source_url, title, error, fetched_at, http_status").eq("prospect_id", prospectId).order("fetched_at", { ascending: false }).limit(5),
  ]);
  const ids = new Set<string>();
  for (const n of notes.data ?? []) if (n.author_id) ids.add(n.author_id);
  for (const a of activities.data ?? []) if (a.actor_id) ids.add(a.actor_id);
  if (prospect.assigned_to) ids.add(prospect.assigned_to);
  const { data: people } = ids.size ? await supabase.from("profiles").select("id, full_name, email").in("id", [...ids]) : { data: [] };
  const names = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name ?? p.email]));
  return {
    prospect,
    drafts: drafts.data ?? [],
    qualification: qual.data?.[0] ?? null,
    notes: notes.data ?? [],
    activities: activities.data ?? [],
    research: research.data ?? [],
    names,
  };
}
