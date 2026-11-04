import { InviteDialog, TeamTable } from "@/components/settings/team";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/server/session";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const user = await requireAdmin();
  const db = createAdminClient();
  const [{ data: profiles }, { data: memberships }, { data: projects }] = await Promise.all([
    db.from("profiles").select("id, email, full_name, app_role, status, created_at").order("created_at"),
    db.from("project_members").select("project_id, user_id"),
    db.from("projects").select("id, name").order("name"),
  ]);
  const members = (profiles ?? []).map((p) => ({ ...p, projects: (memberships ?? []).filter((m) => m.user_id === p.id).map((m) => m.project_id) }));
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle>Team</CardTitle>
          <CardDescription>Administrators manage projects, integrations and policies. Operators work prospects in their assigned projects.</CardDescription>
        </div>
        <InviteDialog projects={projects ?? []} />
      </CardHeader>
      <TeamTable members={members} projects={projects ?? []} currentUserId={user.id} />
    </Card>
  );
}
