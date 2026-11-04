import Link from "next/link";
import { Send } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { OutreachWorkspace, type QueueItem } from "@/components/outreach/workspace";
import { Button } from "@/components/ui/button";
import { createClient, type ServerClient } from "@/lib/supabase/server";
import { loadProspectBundle } from "@/server/queries/prospect-detail";
import { requireCurrentProject } from "@/server/session";

export const metadata = { title: "Outreach" };

type View = "ready" | "review" | "todo" | "followup";

function queueQuery(supabase: ServerClient, projectId: string, view: View, assignee: string | null, head = false) {
  let q = supabase
    .from("project_prospects")
    .select("id, business_name, city, country, instagram_username, qualification_score, outreach_status", head ? { count: "exact", head: true } : { count: "exact" })
    .eq("project_id", projectId)
    .eq("do_not_contact", false);
  if (assignee) q = q.eq("assigned_to", assignee);
  if (view === "ready") q = q.eq("outreach_status", "approved");
  else if (view === "review") q = q.eq("outreach_status", "ready_for_review");
  else if (view === "todo") q = q.in("outreach_status", ["new", "draft"]).in("qualification_status", ["qualified", "needs_review"]);
  else q = q.in("outreach_status", ["contacted", "responded", "interested"]);
  return q;
}

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ view?: string; scope?: string; prospect?: string }> }) {
  const { user, project } = await requireCurrentProject();
  const sp = await searchParams;
  const view = (["ready", "review", "todo", "followup"].includes(sp.view ?? "") ? sp.view : "ready") as View;
  const isAdmin = user.role === "admin";
  const scope = isAdmin ? (sp.scope === "mine" ? "mine" : "all") : "mine";
  const assignee = scope === "mine" ? user.id : null;
  const supabase = await createClient();

  const views: View[] = ["ready", "review", "todo", "followup"];
  const [list, ...countRes] = await Promise.all([
    queueQuery(supabase, project.id, view, assignee).order("qualification_score", { ascending: false, nullsFirst: false }).order("created_at").limit(200),
    ...views.map((v) => queueQuery(supabase, project.id, v, assignee, true)),
  ]);
  const queue = (list.data ?? []) as QueueItem[];
  const counts = Object.fromEntries(views.map((v, i) => [v, countRes[i].count ?? 0]));
  const selectedId = sp.prospect && /^[0-9a-f-]{36}$/i.test(sp.prospect) ? sp.prospect : queue[0]?.id;
  const bundle = selectedId ? await loadProspectBundle(supabase, selectedId) : null;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        title="Outreach"
        description="Review, approve and send first-touch messages yourself. Nothing is sent automatically."
      />
      {total === 0 && !bundle ? (
        <EmptyState
          icon={Send}
          title={scope === "mine" ? "No prospects assigned to you yet" : "Nothing ready for outreach"}
          description="Prospects appear here once they're qualified and have a message to review. Qualify prospects from the Prospects table, then generate messages."
          action={<Button asChild><Link href="/prospects?qual=qualified">View qualified prospects</Link></Button>}
        />
      ) : (
        <OutreachWorkspace queue={queue} bundle={bundle && bundle.prospect.project_id === project.id ? bundle : null} view={view} scope={scope} counts={counts} isAdmin={isAdmin} />
      )}
    </>
  );
}
