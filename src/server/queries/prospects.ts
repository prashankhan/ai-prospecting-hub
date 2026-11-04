import "server-only";
import { z } from "zod";
import { OUTREACH_STATUSES } from "@/lib/domain/outreach";
import type { ServerClient } from "@/lib/supabase/server";

export const PAGE_SIZE = 50;

export const prospectFiltersSchema = z.object({
  q: z.string().trim().max(120).optional().catch(undefined),
  status: z.enum(OUTREACH_STATUSES).optional().catch(undefined),
  qual: z.enum(["pending", "qualified", "needs_review", "disqualified"]).optional().catch(undefined),
  ig: z.enum(["verified", "likely", "not_found", "conflicting", "unknown"]).optional().catch(undefined),
  assigned: z.string().max(40).optional().catch(undefined), // uuid | "me" | "none"
  source: z.string().max(40).optional().catch(undefined),
  job: z.string().uuid().optional().catch(undefined),
  sort: z.enum(["created_at", "business_name", "qualification_score", "last_contacted_at", "city"]).catch("created_at").default("created_at"),
  dir: z.enum(["asc", "desc"]).catch("desc").default("desc"),
  page: z.coerce.number().int().min(1).max(10000).catch(1).default(1),
});
export type ProspectFilters = z.infer<typeof prospectFiltersSchema>;

export const PROSPECT_LIST_COLUMNS =
  "id, business_name, category, city, country, website, instagram_username, instagram_url, instagram_match_status, qualification_score, qualification_status, outreach_status, assigned_to, source, discovered_at, last_contacted_at, do_not_contact, created_at";

/** Builds the filtered prospect query. RLS still restricts rows to accessible projects. */
export function prospectQuery(supabase: ServerClient, projectId: string, f: ProspectFilters, userId: string, columns = PROSPECT_LIST_COLUMNS) {
  let q = supabase.from("project_prospects").select(columns, { count: "exact" }).eq("project_id", projectId);
  if (f.q) {
    const term = f.q.replace(/[%_,()]/g, " ").trim();
    if (term) q = q.or(`business_name.ilike.%${term}%,city.ilike.%${term}%,instagram_username.ilike.%${term}%,website.ilike.%${term}%`);
  }
  if (f.status) q = q.eq("outreach_status", f.status);
  if (f.qual) q = q.eq("qualification_status", f.qual);
  if (f.ig) q = q.eq("instagram_match_status", f.ig);
  if (f.source) q = q.eq("source", f.source);
  if (f.job) q = q.eq("discovery_job_id", f.job);
  if (f.assigned === "me") q = q.eq("assigned_to", userId);
  else if (f.assigned === "none") q = q.is("assigned_to", null);
  else if (f.assigned && z.string().uuid().safeParse(f.assigned).success) q = q.eq("assigned_to", f.assigned);
  return q.order(f.sort, { ascending: f.dir === "asc", nullsFirst: false }).order("id");
}

export async function projectMembers(supabase: ServerClient, projectId: string) {
  // Admins can be assigned in any project; operators only where they are members.
  const [{ data: members }, { data: admins }] = await Promise.all([
    supabase.from("project_members").select("user_id, profiles!project_members_user_id_fkey(id, full_name, email, status)").eq("project_id", projectId),
    supabase.from("profiles").select("id, full_name, email, status").eq("app_role", "admin"),
  ]);
  const map = new Map<string, { id: string; name: string }>();
  for (const a of admins ?? []) if (a.status === "active") map.set(a.id, { id: a.id, name: a.full_name ?? a.email });
  for (const m of members ?? []) {
    const p = m.profiles;
    if (p && p.status === "active") map.set(p.id, { id: p.id, name: p.full_name ?? p.email });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
