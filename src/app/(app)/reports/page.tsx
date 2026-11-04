import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { RangePicker } from "@/components/reports/range-picker";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { OUTREACH_STATUSES, OUTREACH_STATUS_LABELS } from "@/lib/domain/outreach";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatNumber } from "@/lib/utils";
import { getMetrics, parseRange, rangeStart } from "@/server/queries/metrics";
import { requireCurrentProject } from "@/server/session";

export const metadata = { title: "Reports" };

function pct(n: number, d: number) {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
}

function weekStart(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { project } = await requireCurrentProject();
  const range = parseRange((await searchParams).range);
  const supabase = await createClient();
  const from = rangeStart(range);
  let actQ = supabase.from("outreach_activities").select("type, to_status, actor_id, is_manual, created_at, prospect_id").eq("project_id", project.id).in("type", ["contacted", "response_recorded", "status_change", "draft_generated", "draft_approved", "qualified"]).order("created_at", { ascending: false }).limit(10000);
  if (from) actQ = actQ.gte("created_at", from);
  const [m, { data: acts }] = await Promise.all([getMetrics(supabase, project.id, range), actQ]);

  const rows = acts ?? [];
  if (m.total_prospects === 0 && rows.length === 0) {
    return (
      <>
        <PageHeader title="Reports" description={project.name} actions={<RangePicker value={range} />} />
        <EmptyState icon={BarChart3} title="No data to report yet" description="Reports are built only from recorded activity. Import or discover prospects and start outreach to see results here." />
      </>
    );
  }

  const weeks = new Map<string, { contacted: Set<string>; replies: Set<string>; interested: Set<string>; generated: number; approved: number; qualified: number }>();
  for (const a of rows) {
    const w = weekStart(new Date(a.created_at));
    const bucket = weeks.get(w) ?? { contacted: new Set(), replies: new Set(), interested: new Set(), generated: 0, approved: 0, qualified: 0 };
    if (a.type === "contacted") bucket.contacted.add(a.prospect_id);
    if (a.type === "response_recorded") bucket.replies.add(a.prospect_id);
    if (a.to_status === "interested") bucket.interested.add(a.prospect_id);
    if (a.type === "draft_generated") bucket.generated++;
    if (a.type === "draft_approved") bucket.approved++;
    if (a.type === "qualified") bucket.qualified++;
    weeks.set(w, bucket);
  }
  const weekRows = [...weeks.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 26);

  const byActor = new Map<string, { contacted: number; outcomes: number }>();
  for (const a of rows) {
    if (!a.actor_id || !a.is_manual) continue;
    const r = byActor.get(a.actor_id) ?? { contacted: 0, outcomes: 0 };
    if (a.type === "contacted") r.contacted++;
    if (a.type === "response_recorded" || (a.type === "status_change" && a.to_status && ["interested", "not_interested", "trial_registered", "converted"].includes(a.to_status))) r.outcomes++;
    byActor.set(a.actor_id, r);
  }
  const { data: people } = byActor.size ? await supabase.from("profiles").select("id, full_name, email").in("id", [...byActor.keys()]) : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name ?? p.email]));

  const funnel = [
    ["Contacted", m.contacted, null],
    ["Replied", m.replies, m.contacted],
    ["Interested", m.interested, m.contacted],
    ["Trial registered", m.trials, m.contacted],
    ["Converted", m.converted, m.contacted],
  ] as const;

  return (
    <>
      <PageHeader title="Reports" description={`${project.name} · counts are unique prospects unless noted`} actions={<RangePicker value={range} />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="flex-col gap-0.5">
            <CardTitle>Outreach funnel</CardTitle>
            <CardDescription>Manually recorded outcomes in the selected range. Rates are relative to contacted prospects.</CardDescription>
          </CardHeader>
          <Table>
            <THead><TR><TH>Stage</TH><TH className="text-right">Prospects</TH><TH className="text-right">Rate</TH><TH>Recorded</TH></TR></THead>
            <TBody>
              {funnel.map(([label, n, base]) => (
                <TR key={label}>
                  <TD className="font-medium">{label}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(n)}</TD>
                  <TD className="text-right tabular-nums text-muted-foreground">{base === null ? "—" : pct(n, base)}</TD>
                  <TD><Badge>Manual</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader className="flex-col gap-0.5">
            <CardTitle>Current pipeline</CardTitle>
            <CardDescription>All prospects in the project by outreach status (not date filtered).</CardDescription>
          </CardHeader>
          <Table>
            <THead><TR><TH>Status</TH><TH className="text-right">Prospects</TH><TH className="text-right">Share</TH></TR></THead>
            <TBody>
              {OUTREACH_STATUSES.filter((s) => m.status_breakdown[s]).map((s) => (
                <TR key={s}>
                  <TD>{OUTREACH_STATUS_LABELS[s]}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(m.status_breakdown[s])}</TD>
                  <TD className="text-right tabular-nums text-muted-foreground">{pct(m.status_breakdown[s] ?? 0, m.total_prospects)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader className="flex-col gap-0.5">
            <CardTitle>Weekly activity</CardTitle>
            <CardDescription>Weeks start Monday (UTC). Qualifications and drafts are recorded automatically; contacts and replies manually.</CardDescription>
          </CardHeader>
          {weekRows.length === 0 ? <p className="px-4 pb-4 text-sm text-muted-foreground">No activity in this range.</p> : (
            <Table>
              <THead>
                <TR>
                  <TH>Week of</TH><TH className="text-right">Qualified (auto)</TH><TH className="text-right">Drafts generated (auto)</TH>
                  <TH className="text-right">Approved</TH><TH className="text-right">Contacted (manual)</TH><TH className="text-right">Replies (manual)</TH><TH className="text-right">Interested (manual)</TH>
                </TR>
              </THead>
              <TBody>
                {weekRows.map(([w, b]) => (
                  <TR key={w}>
                    <TD>{formatDate(w)}</TD>
                    <TD className="text-right tabular-nums">{b.qualified}</TD>
                    <TD className="text-right tabular-nums">{b.generated}</TD>
                    <TD className="text-right tabular-nums">{b.approved}</TD>
                    <TD className="text-right tabular-nums">{b.contacted.size}</TD>
                    <TD className="text-right tabular-nums">{b.replies.size}</TD>
                    <TD className="text-right tabular-nums">{b.interested.size}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        {byActor.size > 0 && (
          <Card className="overflow-hidden lg:col-span-2">
            <CardHeader className="flex-col gap-0.5">
              <CardTitle>By team member</CardTitle>
              <CardDescription>Manual outreach actions recorded in the selected range.</CardDescription>
            </CardHeader>
            <Table>
              <THead><TR><TH>Member</TH><TH className="text-right">Contacted</TH><TH className="text-right">Outcomes recorded</TH></TR></THead>
              <TBody>
                {[...byActor.entries()].sort((a, b) => b[1].contacted - a[1].contacted).map(([id, r]) => (
                  <TR key={id}>
                    <TD>{names.get(id) ?? "Team member"}</TD>
                    <TD className="text-right tabular-nums">{r.contacted}</TD>
                    <TD className="text-right tabular-nums">{r.outcomes}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
