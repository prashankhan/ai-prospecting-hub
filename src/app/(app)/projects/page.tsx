import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatNumber } from "@/lib/utils";
import { getCurrentProject, requireUser } from "@/server/session";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [{ data: projects }, current] = await Promise.all([
    supabase.from("projects").select("id, name, product_name, target_industry, target_countries, status, created_at").order("name"),
    getCurrentProject(),
  ]);
  const counts = new Map<string, number>();
  await Promise.all(
    (projects ?? []).map(async (p) => {
      const { count } = await supabase.from("project_prospects").select("id", { count: "exact", head: true }).eq("project_id", p.id);
      counts.set(p.id, count ?? 0);
    }),
  );
  const isAdmin = user.role === "admin";
  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project has its own targeting, qualification and messaging configuration. Data is isolated per project."
        actions={isAdmin && <Button variant="primary" asChild><Link href="/projects/new"><Plus /> New project</Link></Button>}
      />
      {!projects?.length ? (
        <EmptyState
          icon={FolderKanban}
          title={isAdmin ? "Create your first project" : "No projects yet"}
          description={isAdmin ? "A project defines what you sell, who you target and how messages should sound." : "An administrator needs to add you to a project."}
          action={isAdmin && <Button variant="primary" asChild><Link href="/projects/new"><Plus /> New project</Link></Button>}
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Project</TH>
                <TH>Industry</TH>
                <TH>Countries</TH>
                <TH className="text-right">Prospects</TH>
                <TH>Status</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {projects.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <Link href={`/projects/${p.id}`} className="font-medium hover:text-accent">{p.name}</Link>
                    {p.id === current?.id && <Badge tone="accent" className="ml-2">Current</Badge>}
                    {p.product_name && p.product_name !== p.name && <p className="text-xs text-muted-foreground">{p.product_name}</p>}
                  </TD>
                  <TD className="text-muted-foreground">{p.target_industry || "—"}</TD>
                  <TD className="text-muted-foreground">{p.target_countries.join(", ") || "—"}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(counts.get(p.id))}</TD>
                  <TD><Badge tone={p.status === "active" ? "success" : "neutral"} className="capitalize">{p.status}</Badge></TD>
                  <TD className="text-muted-foreground">{formatDate(p.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
