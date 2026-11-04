import { PageHeader } from "@/components/app/page-header";
import { EMPTY_PROJECT, ProjectForm } from "@/components/projects/project-form";
import { requireAdmin } from "@/server/session";

export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New project" description="Everything here can be changed later." />
      <ProjectForm initial={EMPTY_PROJECT} />
    </div>
  );
}
