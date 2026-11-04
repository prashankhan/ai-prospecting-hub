"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { PROJECT_COOKIE, getAccessibleProjects, getSessionUser } from "../session";
import { run, UserFacingError, type ActionResult } from "../result";
import { logAudit } from "../settings";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

function safeNext(next: unknown) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export async function signIn(_: unknown, form: FormData): Promise<ActionResult> {
  const parsed = credentialsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { ok: false, error: "Enter a valid email and password." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // Generic message: never reveal whether the account exists.
  if (error) return { ok: false, error: "Incorrect email or password." };
  const user = await getSessionUser();
  if (!user || user.status !== "active") {
    await supabase.auth.signOut();
    return { ok: false, error: "This account is disabled. Contact an administrator." };
  }
  redirect(safeNext(form.get("next")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(PROJECT_COOKIE);
  redirect("/login");
}

function tokenMatches(input: string, expected: string) {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function adminExists(): Promise<boolean> {
  const admin = createAdminClient();
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("app_role", "admin");
  return (count ?? 0) > 0;
}

/**
 * One-time bootstrap of the first administrator. Requires the SETUP_TOKEN from the hosting
 * environment and only works while no administrator exists, so the public cannot self-promote.
 */
export async function bootstrapAdmin(_: unknown, form: FormData): Promise<ActionResult> {
  const result = await run(async () => {
    const { setupToken } = serverEnv();
    if (!setupToken) throw new UserFacingError("SETUP_TOKEN is not configured in the environment.");
    const token = String(form.get("token") ?? "");
    const admin = createAdminClient();
    // Durable rate limit across serverless instances: at most 10 failed attempts per 15 minutes.
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count: failures } = await admin.from("audit_logs").select("id", { count: "exact", head: true }).eq("action", "auth.setup_failed").gte("created_at", since);
    if ((failures ?? 0) >= 10) throw new UserFacingError("Too many failed attempts. Try again in 15 minutes.");
    if (!tokenMatches(token, setupToken)) {
      await logAudit(admin, { actorId: null, action: "auth.setup_failed" });
      throw new UserFacingError("The setup token is incorrect.");
    }
    if (await adminExists()) throw new UserFacingError("An administrator already exists. Sign in instead.");

    const parsed = credentialsSchema.extend({ full_name: z.string().trim().min(1).max(120) }).parse({
      email: form.get("email"), password: form.get("password"), full_name: form.get("full_name"),
    });
    const { data, error } = await admin.auth.admin.createUser({
      email: parsed.email,
      password: parsed.password,
      email_confirm: true,
      user_metadata: { full_name: parsed.full_name },
    });
    if (error || !data.user) throw new UserFacingError(error?.message ?? "Could not create the account.");
    const { error: roleError } = await admin
      .from("profiles")
      .upsert({ id: data.user.id, email: parsed.email, full_name: parsed.full_name, app_role: "admin" });
    if (roleError) throw new Error(roleError.message);
    await logAudit(admin, { actorId: data.user.id, action: "auth.bootstrap_admin", entityType: "profile", entityId: data.user.id });

    const supabase = await createClient();
    await supabase.auth.signInWithPassword({ email: parsed.email, password: parsed.password });
    return undefined;
  }, "Administrator created.");
  if (result.ok) redirect("/projects");
  return result;
}

export async function setPassword(_: unknown, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const password = z.string().min(8, "Use at least 8 characters").max(200).parse(form.get("password"));
    if (password !== form.get("confirm")) throw new UserFacingError("Passwords don't match.");
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new UserFacingError(error.message);
    return undefined;
  }, "Password saved.");
}

export async function selectProject(projectId: string): Promise<ActionResult> {
  return run(async () => {
    const id = z.string().uuid().parse(projectId);
    const projects = await getAccessibleProjects();
    if (!projects.some((p) => p.id === id)) throw new UserFacingError("You don't have access to that project.");
    (await cookies()).set(PROJECT_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 31536000 });
    return undefined;
  });
}

export async function updateOwnProfile(_: unknown, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await getSessionUser();
    if (!user) throw new UserFacingError("Sign in again.");
    const fullName = z.string().trim().min(1).max(120).parse(form.get("full_name"));
    const supabase = await createClient();
    const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
    if (error) throw new Error(error.message);
    return undefined;
  }, "Profile updated.");
}
