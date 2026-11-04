"use server";
import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorize } from "../session";
import { run, UserFacingError, type ActionResult } from "../result";
import { logAudit } from "../settings";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  full_name: z.string().trim().max(120).optional(),
  role: z.enum(["admin", "operator"]),
  project_ids: z.array(z.string().uuid()).max(100),
  delivery: z.enum(["email", "link"]),
});

/**
 * Invites a user. "email" sends Supabase's invitation email; "link" returns a one-time
 * invitation link for the admin to share (useful before SMTP is configured).
 */
export async function inviteUser(input: z.infer<typeof inviteSchema>): Promise<ActionResult<{ link: string | null }>> {
  return run(async () => {
    const actor = await authorize("team.manage");
    const data = inviteSchema.parse(input);
    const admin = createAdminClient();
    const redirectTo = `${serverEnv().appUrl}/auth/confirm?next=/auth/set-password`;
    const { data: existing } = await admin.from("profiles").select("id").ilike("email", data.email).maybeSingle();
    if (existing) throw new UserFacingError("A user with this email already exists.");

    let userId: string;
    let link: string | null = null;
    if (data.delivery === "email") {
      const { data: res, error } = await admin.auth.admin.inviteUserByEmail(data.email, { redirectTo, data: { full_name: data.full_name } });
      if (error || !res.user) throw new UserFacingError(error?.message ?? "Invitation failed.");
      userId = res.user.id;
    } else {
      const { data: res, error } = await admin.auth.admin.generateLink({ type: "invite", email: data.email, options: { redirectTo, data: { full_name: data.full_name } } });
      if (error || !res.user) throw new UserFacingError(error?.message ?? "Could not create an invitation link.");
      userId = res.user.id;
      const tokenHash = res.properties?.hashed_token;
      link = tokenHash ? `${serverEnv().appUrl}/auth/confirm?token_hash=${tokenHash}&type=invite&next=/auth/set-password` : res.properties?.action_link ?? null;
    }
    await admin.from("profiles").upsert({ id: userId, email: data.email, full_name: data.full_name || null, app_role: data.role });
    if (data.project_ids.length) {
      await admin.from("project_members").insert(data.project_ids.map((p) => ({ project_id: p, user_id: userId, added_by: actor.id })));
    }
    await logAudit(admin, { actorId: actor.id, action: "team.invite", entityType: "profile", entityId: userId, details: { email: data.email, role: data.role, projects: data.project_ids, delivery: data.delivery } });
    return { link };
  }, "Invitation created.");
}

async function adminCount(admin: ReturnType<typeof createAdminClient>) {
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("app_role", "admin").eq("status", "active");
  return count ?? 0;
}

export async function updateUserAccess(userId: string, patch: { role?: "admin" | "operator"; status?: "active" | "disabled" }): Promise<ActionResult> {
  return run(async () => {
    const actor = await authorize("team.manage");
    const id = z.string().uuid().parse(userId);
    const p = z.object({ role: z.enum(["admin", "operator"]).optional(), status: z.enum(["active", "disabled"]).optional() }).parse(patch);
    const admin = createAdminClient();
    const { data: target } = await admin.from("profiles").select("app_role, status").eq("id", id).single();
    if (!target) throw new UserFacingError("User not found.");
    const losesAdmin = target.app_role === "admin" && target.status === "active" && (p.role === "operator" || p.status === "disabled");
    if (losesAdmin && (await adminCount(admin)) <= 1) throw new UserFacingError("At least one active administrator is required.");
    if (id === actor.id && p.status === "disabled") throw new UserFacingError("You can't disable your own account.");
    const { error } = await admin.from("profiles").update({ ...(p.role ? { app_role: p.role } : {}), ...(p.status ? { status: p.status } : {}) }).eq("id", id);
    if (error) throw new Error(error.message);
    if (p.status === "disabled") {
      // Revoke sessions so access ends immediately, not at token expiry.
      await admin.auth.admin.signOut(id).catch(() => undefined);
    }
    await logAudit(admin, { actorId: actor.id, action: "team.update_access", entityType: "profile", entityId: id, details: p });
    return undefined;
  }, "Access updated.");
}

export async function setUserProjects(userId: string, projectIds: string[]): Promise<ActionResult> {
  return run(async () => {
    const actor = await authorize("team.manage");
    const id = z.string().uuid().parse(userId);
    const ids = z.array(z.string().uuid()).max(200).parse(projectIds);
    const admin = createAdminClient();
    await admin.from("project_members").delete().eq("user_id", id).not("project_id", "in", `(${ids.length ? ids.join(",") : "00000000-0000-0000-0000-000000000000"})`);
    if (ids.length) {
      await admin.from("project_members").upsert(ids.map((p) => ({ project_id: p, user_id: id, added_by: actor.id })), { onConflict: "project_id,user_id", ignoreDuplicates: true });
    }
    await logAudit(admin, { actorId: actor.id, action: "team.set_projects", entityType: "profile", entityId: id, details: { projects: ids } });
    return undefined;
  }, "Project access updated.");
}
