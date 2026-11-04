import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/app/page-header";
import { RangePicker } from "@/components/reports/range-picker";
import { Stat } from "@/components/reports/stat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cn, formatRelative } from "@/lib/utils";
import { getMetrics, parseRange } from "@/server/queries/metrics";
import { requireCurrentProject } from "@/server/session";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string; error?: string }> }) {
  const { user, project } = await requireCurrentProject();
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const supabase = await createClient();
  const [m, { data: recent }, { count: myQueue }] = await Promise.all([
    getMetrics(supabase, project.id, range),
    supabase.from("jobs").select("id, type, provider, status, new_count, processed, created_at").eq("project_id", project.id).order("created_at", { ascending: false }).limit(5),
    supabase.from("project_prospects").select("id", { count: "exact", head: true }).eq("project_id", project.id).eq("assigned_to", user.id).in("outreach_status", ["approved", "ready_for_review"]),
  ]);

  const isAdmin = user.role === "admin";
  let aiReady = true;
  let discoveryReady = true;
  if (isAdmin) {
    const admin = createAdminClient();
    const [{ count: ai }, { count: disc }] = await Promise.all([
      admin.from("provider_configs").select("id", { count: "exact", head: true }).eq("kind", "ai").eq("is_default", true).eq("is_enabled", true),
      admin.from("provider_configs").select("id", { count: "exact", head: true }).eq("kind", "discovery").eq("is_enabled", true),
    ]);
    aiReady = Boolean(ai);
    discoveryReady = Boolean(disc);
  }
  const steps = [
    { done: aiReady, label: "Configure an AI provider", href: "/settings/ai", admin: true },
    { done: m.total_prospects > 0, label: discoveryReady ? "Discover or import prospects" : "Import a CSV or configure discovery", href: discoveryReady ? "/discover" : "/prospects/import", admin: true },
    { done: m.qualified + m.needs_review > 0, label: "Qualify prospects with AI", href: "/prospects?qual=pending" },
    { done: m.messages_generated > 0 || m.drafts_approved > 0, label: "Generate and approve a message", href: "/outreach?view=todo" },
    { done: m.contacted > 0, label: "Send your first message and mark it contacted", href: "/outreach" },
  ].filter((s) => isAdmin || !s.admin);
  const onboarding = steps.some((s) => !s.done);

  return (
    <>
      <PageHeader title="Dashboard" description={`${project.name} · activity and outcomes from recorded data`} actions={<RangePicker value={range} />} />
      {sp.error === "forbidden" && <p className="mb-4 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">That page is only available to administrators.</p>}

      {onboarding && (
        <Card className="mb-6">
          <CardHeader className="flex-col gap-0.5">
            <CardTitle>Get set up</CardTitle>
            <CardDescription>Complete these steps to run the full prospecting workflow.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ol className="divide-y divide-border">
              {steps.map((s, i) => (
                <li key={s.label}>
                  <Link href={s.href} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-hover">
                    {s.done ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-subtle-foreground" />}
                    <span className={cn(s.done && "text-muted-foreground line-through")}>{i + 1}. {s.label}</span>
                    {!s.done && <ArrowRight className="ml-auto size-4 text-muted-foreground" />}
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-6">
        <section>
          <SectionHeader title="Pipeline" description="Recorded automatically by discovery, imports and the agent." />
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Total prospects" value={m.total_prospects} hint="All time" />
            <Stat label="New in range" value={m.new_prospects} />
            <Stat label="Qualified" value={m.qualified} hint={`${m.needs_review} need review`} />
            <Stat label="Duplicates skipped" value={m.duplicates_skipped} hint={`${m.already_known} already known`} />
            <Stat label="Messages generated" value={m.messages_generated} />
            <Stat label="Drafts approved" value={m.drafts_approved} />
          </dl>
        </section>
        <section>
          <SectionHeader title="Outcomes" description="Recorded manually by your team after sending messages themselves." />
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat label="Contacted" value={m.contacted} manual />
            <Stat label="Replies" value={m.replies} manual />
            <Stat label="Interested" value={m.interested} manual />
            <Stat label="Trials" value={m.trials} manual />
            <Stat label="Converted" value={m.converted} manual />
          </dl>
        </section>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div><CardTitle>Your queue</CardTitle><CardDescription>Assigned prospects awaiting review or ready to send.</CardDescription></div>
              <Button size="sm" variant="primary" asChild><Link href="/outreach?scope=mine">Open outreach</Link></Button>
            </CardHeader>
            <CardContent><p className="text-2xl font-semibold tabular-nums">{myQueue ?? 0}</p></CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div><CardTitle>Recent jobs</CardTitle><CardDescription>Discovery, imports and AI batches.</CardDescription></div>
              <Button size="sm" asChild><Link href="/discover">View all</Link></Button>
            </CardHeader>
            <CardContent className="p-0">
              {!recent?.length ? <p className="px-4 py-4 text-sm text-muted-foreground">No jobs yet.</p> : (
                <ul className="divide-y divide-border">
                  {recent.map((j) => (
                    <li key={j.id}>
                      <Link href={`/discover/jobs/${j.id}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-surface-hover">
                        <span>{j.provider === "csv" ? "CSV import" : j.type === "discovery" ? "Discovery" : j.type === "qualification" ? "Qualification" : "Message generation"} · <span className="capitalize text-muted-foreground">{j.status}</span></span>
                        <span className="text-xs text-muted-foreground">{j.type === "discovery" ? `${j.new_count} new · ` : `${j.processed} processed · `}{formatRelative(j.created_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
