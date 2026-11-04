import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Send } from "lucide-react";
import { MessageComposer } from "@/components/outreach/message-composer";
import { ActivityList } from "@/components/prospects/activity-list";
import { BusinessFacts } from "@/components/prospects/business-facts";
import { InstagramPanel } from "@/components/prospects/instagram-panel";
import { NotesPanel } from "@/components/prospects/notes-panel";
import { ProspectActions } from "@/components/prospects/prospect-actions";
import { QualificationPanel } from "@/components/prospects/qualification-panel";
import { StatusControl } from "@/components/prospects/status-control";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import { loadProspectBundle } from "@/server/queries/prospect-detail";
import { projectMembers } from "@/server/queries/prospects";
import { requireUser } from "@/server/session";

export const metadata = { title: "Prospect" };

export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();
  const bundle = /^[0-9a-f-]{36}$/i.test(id) ? await loadProspectBundle(supabase, id) : null;
  if (!bundle) notFound();
  const { prospect: p, drafts, qualification, notes, activities, research, names } = bundle;
  const members = await projectMembers(supabase, p.project_id);
  const isAdmin = user.role === "admin";
  const evidence = (p.instagram_evidence as unknown as { username: string; source: string; url?: string; observed_at: string }[]) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/prospects" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Prospects</Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{p.business_name}</h1>
            <p className="text-sm text-muted-foreground">
              {[p.category, [p.city, p.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "No details"}
              {p.assigned_to && <> · Assigned to {names[p.assigned_to] ?? "team member"}</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusControl prospectId={p.id} status={p.outreach_status} isAdmin={isAdmin} hasApprovedDraft={drafts.some((d) => d.status === "approved")} />
            <Button size="sm" asChild><Link href={`/outreach?prospect=${p.id}`}><Send /> Open in outreach</Link></Button>
            <ProspectActions prospect={p} members={members} isAdmin={isAdmin} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Message</CardTitle></CardHeader>
            <CardContent>
              <MessageComposer prospectId={p.id} status={p.outreach_status} doNotContact={p.do_not_contact} instagramUrl={p.instagram_url} instagramStatus={p.instagram_match_status} drafts={drafts} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Qualification</CardTitle></CardHeader>
            <CardContent><QualificationPanel prospectId={p.id} q={qualification} status={p.qualification_status} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent><ActivityList items={activities} names={names} /></CardContent>
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Business information</CardTitle><Badge tone="outline">Source data</Badge></CardHeader>
            <CardContent><BusinessFacts p={p} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Instagram</CardTitle></CardHeader>
            <CardContent><InstagramPanel prospectId={p.id} username={p.instagram_username} url={p.instagram_url} status={p.instagram_match_status} evidence={evidence} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
            <CardContent><NotesPanel prospectId={p.id} notes={notes} names={names} /></CardContent>
          </Card>
          {research.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Research log</CardTitle></CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {research.map((r) => (
                    <li key={r.id} className="flex flex-col">
                      <a href={r.source_url} target="_blank" rel="noreferrer noopener" className="truncate text-accent hover:underline">{r.title ?? r.source_url}</a>
                      <span className="text-xs text-muted-foreground">{formatDateTime(r.fetched_at)} · {r.error ? <span className="text-danger">{r.error}</span> : `HTTP ${r.http_status}`}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
