import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { DeleteProject } from "@/components/projects/delete-project";
import { PolicyOverrides } from "@/components/projects/policy-overrides";
import { ProjectForm } from "@/components/projects/project-form";
import { ProjectMembers } from "@/components/projects/project-members";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { duplicatePolicyOverridesSchema } from "@/lib/domain/policy";
import type { ProjectInput } from "@/lib/domain/project";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceSettings } from "@/server/settings";
import { requireUser } from "@/server/session";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project) notFound();
  const isAdmin = user.role === "admin";

  const initial: ProjectInput = {
    name: project.name,
    product_name: project.product_name,
    product_description: project.product_description,
    website: project.website ?? "",
    target_industry: project.target_industry,
    target_countries: project.target_countries,
    target_cities: project.target_cities,
    ideal_customer_profile: project.ideal_customer_profile,
    qualification_criteria: project.qualification_criteria,
    exclusion_criteria: project.exclusion_criteria,
    preferred_channel: project.preferred_channel,
    messaging_tone: project.messaging_tone,
    ai_instructions: project.ai_instructions,
    outreach_objective: project.outreach_objective,
    qualification_threshold: project.qualification_threshold,
    status: project.status,
  };

  let users: { id: string; email: string; full_name: string | null; app_role: string; status: string }[] = [];
  let memberIds: string[] = [];
  let workspacePolicy = null;
  if (isAdmin) {
    const admin = createAdminClient();
    const [{ data: u }, { data: m }, ws] = await Promise.all([
      admin.from("profiles").select("id, email, full_name, app_role, status").order("email"),
      admin.from("project_members").select("user_id").eq("project_id", id),
      getWorkspaceSettings(admin),
    ]);
    users = u ?? [];
    memberIds = (m ?? []).map((r) => r.user_id);
    workspacePolicy = ws.policy;
  }
  const overrides = duplicatePolicyOverridesSchema.safeParse(project.duplicate_policy_overrides);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={<span className="flex items-center gap-2">{project.name} <Badge tone={project.status === "active" ? "success" : "neutral"} className="capitalize">{project.status}</Badge></span>}
        description={isAdmin ? "Configure targeting, qualification and messaging for this project." : "Project configuration (read-only for operators)."}
      />
      <Tabs defaultValue="configuration">
        <TabsList>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
          {isAdmin && <TabsTrigger value="members">Members</TabsTrigger>}
          {isAdmin && <TabsTrigger value="policy">Duplicate policy</TabsTrigger>}
          {isAdmin && <TabsTrigger value="danger">Danger zone</TabsTrigger>}
        </TabsList>
        <TabsContent value="configuration">
          <ProjectForm projectId={project.id} initial={initial} readOnly={!isAdmin} />
        </TabsContent>
        {isAdmin && (
          <>
            <TabsContent value="members">
              <Card>
                <CardHeader className="flex-col gap-0.5">
                  <CardTitle>Members</CardTitle>
                  <CardDescription>Operators only see projects they are members of. Administrators can access every project.</CardDescription>
                </CardHeader>
                <CardContent><ProjectMembers projectId={project.id} users={users} memberIds={memberIds} /></CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="policy">
              <Card>
                <CardHeader className="flex-col gap-0.5">
                  <CardTitle>Project duplicate policy</CardTitle>
                  <CardDescription>Override workspace duplicate-prevention defaults for this project only.</CardDescription>
                </CardHeader>
                <CardContent>
                  {workspacePolicy && <PolicyOverrides projectId={project.id} workspace={workspacePolicy} overrides={overrides.success ? overrides.data : {}} />}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="danger">
              <Card className="border-danger/30">
                <CardHeader className="flex-col gap-0.5">
                  <CardTitle>Delete project</CardTitle>
                  <CardDescription>Permanently removes the project and all of its data. This cannot be undone.</CardDescription>
                </CardHeader>
                <CardContent><DeleteProject projectId={project.id} name={project.name} /></CardContent>
              </Card>
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
