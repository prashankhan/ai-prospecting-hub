import Link from "next/link";
import { Download, Radar, Upload, Users } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { ProspectFilters } from "@/components/prospects/filters";
import { ProspectTable, type ProspectRow } from "@/components/prospects/prospect-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { PAGE_SIZE, projectMembers, prospectFiltersSchema, prospectQuery } from "@/server/queries/prospects";
import { requireCurrentProject } from "@/server/session";

export const metadata = { title: "Prospects" };

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, project } = await requireCurrentProject();
  const raw = await searchParams;
  const filters = prospectFiltersSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const supabase = await createClient();
  const from = (filters.page - 1) * PAGE_SIZE;
  const [{ data, count }, members] = await Promise.all([
    prospectQuery(supabase, project.id, filters, user.id).range(from, from + PAGE_SIZE - 1),
    projectMembers(supabase, project.id),
  ]);
  const rows = (data ?? []) as unknown as ProspectRow[];
  const hasFilters = ["q", "status", "qual", "ig", "assigned", "source", "job"].some((k) => raw[k]);
  const isAdmin = user.role === "admin";
  const exportQs = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" && k !== "page" ? [[k, v]] : [])));

  return (
    <>
      <PageHeader
        title="Prospects"
        description={`Businesses in ${project.name}. Source data and AI assessments are kept separate.`}
        actions={
          <>
            <Button asChild><a href={`/api/prospects/export?${exportQs}`} download><Download /> Export CSV</a></Button>
            {isAdmin && <Button asChild><Link href="/prospects/import"><Upload /> Import CSV</Link></Button>}
            {isAdmin && <Button variant="primary" asChild><Link href="/discover"><Radar /> Discover</Link></Button>}
          </>
        }
      />
      {!hasFilters && (count ?? 0) === 0 ? (
        <EmptyState
          icon={Users}
          title="No prospects yet"
          description={isAdmin ? "Import a CSV of businesses you've collected, or run a discovery search. Every record goes through duplicate checks." : "An administrator can import or discover prospects for this project."}
          action={isAdmin && (
            <>
              <Button asChild><Link href="/prospects/import"><Upload /> Import CSV</Link></Button>
              <Button variant="primary" asChild><Link href="/discover"><Radar /> Start discovery</Link></Button>
            </>
          )}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <ProspectFilters members={members} />
          <Card className="overflow-hidden">
            {rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">No prospects match these filters.</p>
            ) : (
              <ProspectTable rows={rows} total={count ?? 0} page={filters.page} pageSize={PAGE_SIZE} members={members} projectId={project.id} isAdmin={isAdmin} />
            )}
          </Card>
        </div>
      )}
    </>
  );
}
