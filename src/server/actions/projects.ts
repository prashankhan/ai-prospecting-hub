"use server";
import { cookies } from "next/headers";
import { z } from "zod";
import { duplicatePolicyOverridesSchema } from "@/lib/domain/policy";
import { projectInputSchema, type ProjectInput } from "@/lib/domain/project";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { authorize, PROJECT_COOKIE } from "../session";
import { check, run, UserFacingError, type ActionResult } from "../result";
import { logAudit } from "../settings";

export async function createProject(input: ProjectInput): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await authorize("projects.manage");
    const data = projectInputSchema.parse(input);
    const supabase = await createClient();
    const row = check(
      await supabase.from("projects").insert({ ...data, website: data.website || null, created_by: user.id }).select("id").single(),
    );
    await supabase.from("project_members").insert({ project_id: row.id, user_id: user.id, added_by: user.id });
    await logAudit(createAdminClient(), { actorId: user.id, projectId: row.id, action: "project.create", entityType: "project", entityId: row.id });
    (await cookies()).set(PROJECT_COOKIE, row.id, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 31536000 });
    return { id: row.id };
  }, "Project created.");
}

export async function updateProject(projectId: string, input: ProjectInput): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize("projects.manage", projectId);
    const data = projectInputSchema.parse(input);
    const supabase = await createClient();
    check(await supabase.from("projects").update({ ...data, website: data.website || null }).eq("id", projectId).select("id").single());
    await logAudit(createAdminClient(), { actorId: user.id, projectId, action: "project.update", entityType: "project", entityId: projectId });
    return undefined;
  }, "Project saved.");
}

export async function updateProjectPolicyOverrides(projectId: string, overrides: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize("settings.manage", projectId);
    const data = duplicatePolicyOverridesSchema.parse(overrides);
    const supabase = await createClient();
    check(await supabase.from("projects").update({ duplicate_policy_overrides: data }).eq("id", projectId).select("id").single());
    await logAudit(createAdminClient(), { actorId: user.id, projectId, action: "project.policy_overrides", details: data });
    return undefined;
  }, "Project policy saved.");
}

export async function deleteProject(projectId: string, confirmName: string): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize("projects.manage", projectId);
    const supabase = await createClient();
    const project = check(await supabase.from("projects").select("name").eq("id", projectId).single());
    if (project.name.trim().toLowerCase() !== confirmName.trim().toLowerCase()) {
      throw new UserFacingError("Type the project name exactly to confirm.");
    }
    check(await supabase.from("projects").delete().eq("id", projectId).select("id"));
    await logAudit(createAdminClient(), { actorId: user.id, action: "project.delete", entityType: "project", entityId: projectId, details: { name: project.name } });
    return undefined;
  }, "Project deleted.");
}

export async function setProjectMembers(projectId: string, userIds: string[]): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize("team.manage", projectId);
    const ids = z.array(z.string().uuid()).max(500).parse(userIds);
    const supabase = await createClient();
    const current = check(await supabase.from("project_members").select("user_id").eq("project_id", projectId));
    const currentIds = new Set(current.map((m) => m.user_id));
    const toAdd = ids.filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !ids.includes(id));
    if (toAdd.length) {
      check(await supabase.from("project_members").insert(toAdd.map((id) => ({ project_id: projectId, user_id: id, added_by: user.id }))).select("user_id"));
    }
    if (toRemove.length) {
      check(await supabase.from("project_members").delete().eq("project_id", projectId).in("user_id", toRemove).select("user_id"));
    }
    await logAudit(createAdminClient(), { actorId: user.id, projectId, action: "project.members", details: { added: toAdd, removed: toRemove } });
    return undefined;
  }, "Members updated.");
}
