import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { CancelJobButton, JobProgressDriver } from "@/components/discover/job-progress";
import { JOB_TYPE_LABELS, JobStatusBadge } from "@/components/discover/job-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { requireUser } from "@/server/session";

export const metadata = { title: "Job" };

const OUTCOME: Record<string, { label: string; tone: "success" | "info" | "neutral" | "warning" | "danger" }> = {
  new: { label: "New", tone: "success" },
  known_added: { label: "Known · added", tone: "info" },
  updated: { label: "Known · refreshed", tone: "info" },
  skipped_existing: { label: "Already in project", tone: "neutral" },
  skipped_other_project: { label: "Skipped · other project", tone: "neutral" },
  suppressed: { label: "Do not contact", tone: "neutral" },
  excluded: { label: "Excluded", tone: "neutral" },
  ambiguous: { label: "Needs review", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  processed: { label: "Done", tone: "success" },
  job_failed: { label: "Job failed", tone: "danger" },
};

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ outcome?: string }> }) {
  const { id } = await params;
  const { outcome } = await searchParams;
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
  if (!job) notFound();
  let eventsQuery = supabase.from("job_events").select("id, outcome, record_ref, message, data, created_at").eq("job_id", id).order("id", { ascending: false }).limit(300);
  if (outcome && OUTCOME[outcome]) eventsQuery = eventsQuery.eq("outcome", outcome);
  const { data: events } = await eventsQuery;
  const active = job.status === "queued" || job.status === "running";
  const isDiscovery = job.type === "discovery";
  const pct = job.total ? Math.min(100, Math.round((job.processed / job.total) * 100)) : active ? 5 : 100;
  const p = (job.params ?? {}) as { query?: { keywords?: string; city?: string; country?: string; exclusions?: string[] }; file_name?: string; max_results?: number };

  const stats = isDiscovery
    ? [["New profiles", job.new_count, "new"], ["Already known", job.known_count, "known_added"], ["Skipped", job.skipped_count, "skipped_existing"], ["Ambiguous", job.ambiguous_count, "ambiguous"], ["Failed", job.failed_count, "failed"]] as const
    : [["Processed", job.processed, "processed"], ["Failed", job.failed_count, "failed"]] as const;

  return (
    <div className="flex flex-col gap-5">
      <JobProgressDriver jobId={job.id} active={active} />
      <div>
        <Link href="/discover" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Discover</Link>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              {job.provider === "csv" ? "CSV import" : JOB_TYPE_LABELS[job.type]} <JobStatusBadge status={job.status} />
            </h1>
            <p className="text-sm text-muted-foreground">
              {job.provider === "csv" ? p.file_name : isDiscovery ? [p.query?.keywords, p.query?.city, p.query?.country].filter(Boolean).join(" · ") : `${job.total} prospects`}
              {" · "}Started {formatDateTime(job.created_at)}{job.finished_at && ` · Finished ${formatDateTime(job.finished_at)}`}
            </p>
          </div>
          <div className="flex gap-2">
            {active && user.role === "admin" && <CancelJobButton jobId={job.id} />}
            {isDiscovery && job.ambiguous_count > 0 && <Button size="sm" asChild><Link href="/discover/review">Review matches</Link></Button>}
            {isDiscovery && <Button size="sm" variant="primary" asChild><Link href={`/prospects?job=${job.id}`}>View prospects</Link></Button>}
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div>
            <div className="mb-1.5 flex justify-between text-sm">
              <span className="text-muted-foreground">{active ? (job.status === "queued" ? "Waiting for a worker…" : "Processing…") : "Progress"}</span>
              <span className="tabular-nums">{formatNumber(job.processed)} / {formatNumber(job.total)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {stats.map(([label, value, key]) => (
              <Link key={label} href={`?outcome=${key}`} scroll={false} className="rounded-md border border-border px-3 py-2 hover:border-border-strong">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatNumber(value)}</dd>
              </Link>
            ))}
          </dl>
          {job.last_error && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{job.last_error}</p>}
          {active && <p className="text-xs text-muted-foreground">You can close this page — the job continues in the background{job.attempts > 0 ? ` (retry ${job.attempts}/${job.max_attempts})` : ""}.</p>}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Records</CardTitle>
          {outcome && <Button size="sm" variant="ghost" asChild><Link href="?" scroll={false}>Show all</Link></Button>}
        </CardHeader>
        {!events?.length ? <CardContent className="text-sm text-muted-foreground">{active ? "Records will appear as they're processed." : "No records."}</CardContent> : (
          <Table>
            <THead><TR><TH>Record</TH><TH>Outcome</TH><TH>Detail</TH><TH>Time</TH></TR></THead>
            <TBody>
              {events.map((e) => {
                const d = (e.data ?? {}) as { prospect_id?: string | null };
                const o = OUTCOME[e.outcome] ?? { label: e.outcome, tone: "neutral" as const };
                return (
                  <TR key={e.id}>
                    <TD className="max-w-72 truncate">
                      {d.prospect_id ? <Link className="hover:text-accent" href={`/prospects/${d.prospect_id}`}>{isDiscovery ? e.record_ref : "Open prospect"}</Link> : e.record_ref ?? "—"}
                    </TD>
                    <TD><Badge tone={o.tone}>{o.label}</Badge></TD>
                    <TD className="max-w-96 truncate text-muted-foreground">{e.message ?? ""}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(e.created_at)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
