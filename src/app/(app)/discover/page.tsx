import Link from "next/link";
import { GitCompareArrows, History, Upload } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader, SectionHeader } from "@/components/app/page-header";
import { DiscoveryForm } from "@/components/discover/discovery-form";
import { JOB_TYPE_LABELS, JobStatusBadge } from "@/components/discover/job-status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { getWorkspaceSettings } from "@/server/settings";
import { requireCurrentProject } from "@/server/session";
import { usageToday } from "@/server/usage";

export const metadata = { title: "Discover" };

function describeJob(j: { type: string; provider: string | null; params: unknown }) {
  const p = (j.params ?? {}) as { query?: { keywords?: string; city?: string; country?: string }; file_name?: string; prospect_ids?: string[] };
  if (j.provider === "csv") return `CSV import · ${p.file_name ?? "file"}`;
  if (j.type === "discovery") return [p.query?.keywords, p.query?.city, p.query?.country].filter(Boolean).join(" · ");
  return `${JOB_TYPE_LABELS[j.type]} · ${p.prospect_ids?.length ?? 0} prospects`;
}

export default async function DiscoverPage() {
  const { user, project } = await requireCurrentProject();
  const supabase = await createClient();
  const isAdmin = user.role === "admin";
  const [{ data: proj }, { data: jobs }, { count: pendingMatches }] = await Promise.all([
    supabase.from("projects").select("target_industry, target_countries, target_cities").eq("id", project.id).single(),
    supabase.from("jobs").select("id, type, provider, params, status, total, processed, new_count, known_count, skipped_count, ambiguous_count, failed_count, created_at").eq("project_id", project.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("ambiguous_matches").select("id", { count: "exact", head: true }).eq("project_id", project.id).eq("status", "pending"),
  ]);

  let providerReady = false;
  let limits = { discovery_max_results_per_job: 60, discovery_daily_requests: 50 };
  let used = 0;
  if (isAdmin) {
    const admin = createAdminClient();
    const [{ data: cfg }, ws, u] = await Promise.all([
      admin.from("provider_configs").select("is_enabled, encrypted_secret").eq("kind", "discovery").eq("provider", "google_places").maybeSingle(),
      getWorkspaceSettings(admin),
      usageToday(admin, "discovery"),
    ]);
    providerReady = Boolean(cfg?.is_enabled && cfg.encrypted_secret);
    limits = ws.limits;
    used = u;
  }

  return (
    <>
      <PageHeader
        title="Discover"
        description={`Find new businesses for ${project.name}.`}
        actions={
          <>
            <Button asChild><Link href="/discover/review"><GitCompareArrows /> Review matches{pendingMatches ? ` (${pendingMatches})` : ""}</Link></Button>
            {isAdmin && <Button asChild><Link href="/prospects/import"><Upload /> Import CSV</Link></Button>}
          </>
        }
      />
      <div className="flex flex-col gap-6">
        {isAdmin ? (
          <DiscoveryForm
            projectId={project.id}
            defaults={{ industry: proj?.target_industry ?? "", countries: proj?.target_countries ?? [], cities: proj?.target_cities ?? [] }}
            providerReady={providerReady}
            maxResults={limits.discovery_max_results_per_job}
            remainingRequests={Math.max(0, limits.discovery_daily_requests - used)}
          />
        ) : (
          <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">Discovery runs paid searches, so only administrators can start it. You can review results and ambiguous matches below.</p>
        )}

        <section>
          <SectionHeader title="History" description="Discovery searches, CSV imports and AI batch jobs for this project." />
          {!jobs?.length ? (
            <EmptyState icon={History} title="No jobs yet" description="Searches and imports you run will appear here with their duplicate statistics." />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <THead>
                  <TR>
                    <TH>Job</TH><TH>Status</TH><TH className="text-right">New</TH><TH className="text-right">Known</TH>
                    <TH className="text-right">Skipped</TH><TH className="text-right">Review</TH><TH className="text-right">Failed</TH><TH>Started</TH>
                  </TR>
                </THead>
                <TBody>
                  {jobs.map((j) => (
                    <TR key={j.id}>
                      <TD className="max-w-80">
                        <Link href={`/discover/jobs/${j.id}`} className="block truncate font-medium hover:text-accent">{describeJob(j) || "Job"}</Link>
                        <span className="text-xs text-muted-foreground">{j.provider === "csv" ? "CSV import" : JOB_TYPE_LABELS[j.type]} · {formatNumber(j.processed)}/{formatNumber(j.total)}</span>
                      </TD>
                      <TD><JobStatusBadge status={j.status} /></TD>
                      <TD className="text-right tabular-nums">{j.type === "discovery" ? j.new_count : "—"}</TD>
                      <TD className="text-right tabular-nums">{j.type === "discovery" ? j.known_count : "—"}</TD>
                      <TD className="text-right tabular-nums">{j.type === "discovery" ? j.skipped_count : "—"}</TD>
                      <TD className="text-right tabular-nums">{j.type === "discovery" ? j.ambiguous_count : "—"}</TD>
                      <TD className="text-right tabular-nums">{j.failed_count}</TD>
                      <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(j.created_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}
