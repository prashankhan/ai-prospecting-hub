import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { assertCan, ForbiddenError, type AppRole, type Capability } from "@/lib/domain/permissions";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export const PROJECT_COOKIE = "aph_project";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  role: AppRole;
  status: "active" | "disabled";
}

export type ProjectSummary = Pick<Tables<"projects">, "id" | "name" | "status" | "product_name">;

/** Verified user + profile for this request (null when signed out or not configured). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, app_role, status")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!profile) return null;
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.app_role,
    status: profile.status,
  };
});

export async function requireUser(): Promise<SessionUser> {
  if (!isSupabaseConfigured()) redirect("/setup");
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/login?error=disabled");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard?error=forbidden");
  return user;
}

/** Projects visible to the user (RLS returns all for admins, memberships for operators). */
export const getAccessibleProjects = cache(async (): Promise<ProjectSummary[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, status, product_name")
    .neq("status", "archived")
    .order("name");
  return data ?? [];
});

/** The selected project, validated against the user's access on every request. */
export const getCurrentProject = cache(async (): Promise<ProjectSummary | null> => {
  const projects = await getAccessibleProjects();
  if (projects.length === 0) return null;
  const selected = (await cookies()).get(PROJECT_COOKIE)?.value;
  return projects.find((p) => p.id === selected) ?? projects[0];
});

export async function requireCurrentProject(): Promise<{ user: SessionUser; project: ProjectSummary }> {
  const user = await requireUser();
  const project = await getCurrentProject();
  if (!project) redirect("/projects?empty=1");
  return { user, project };
}

/** Server-side guard for actions: user is active, has the capability and can access the project. */
export async function authorize(capability: Capability, projectId?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || user.status !== "active") throw new ForbiddenError("Your session has expired. Sign in again.");
  assertCan(user.role, capability);
  if (projectId) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("is_project_member", { p_project_id: projectId });
    if (error || data !== true) throw new ForbiddenError("You don't have access to this project.");
  }
  return user;
}
