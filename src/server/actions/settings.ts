"use server";
import { duplicatePolicySchema, usageLimitsSchema } from "@/lib/domain/policy";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { authorize } from "../session";
import { check, run, type ActionResult } from "../result";
import { logAudit } from "../settings";

export async function updateDuplicatePolicy(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize("settings.manage");
    const policy = duplicatePolicySchema.parse(input);
    const supabase = await createClient();
    check(await supabase.from("app_settings").update({ duplicate_policy: policy, updated_by: user.id }).eq("id", true).select("id").single());
    await logAudit(createAdminClient(), { actorId: user.id, action: "settings.duplicate_policy", details: policy });
    return undefined;
  }, "Duplicate prevention policy saved.");
}

export async function updateUsageLimits(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize("settings.manage");
    const limits = usageLimitsSchema.parse(input);
    const supabase = await createClient();
    check(await supabase.from("app_settings").update({ usage_limits: limits, updated_by: user.id }).eq("id", true).select("id").single());
    await logAudit(createAdminClient(), { actorId: user.id, action: "settings.usage_limits", details: limits });
    return undefined;
  }, "Usage limits saved.");
}
