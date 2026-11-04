import { PageHeader } from "@/components/app/page-header";
import { CsvImport } from "@/components/prospects/csv-import";
import { requireCurrentProject } from "@/server/session";
import { redirect } from "next/navigation";

export const metadata = { title: "Import CSV" };

export default async function ImportPage() {
  const { user, project } = await requireCurrentProject();
  if (user.role !== "admin") redirect("/prospects");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Import CSV" description="Every row is normalized and checked against known businesses before it's added." />
      <CsvImport projectId={project.id} projectName={project.name} />
    </div>
  );
}
