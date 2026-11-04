"use server";
import { z } from "zod";
import { getAIAdapter } from "@/lib/ai/providers";
import { AI_PROVIDER_IDS, ProviderError, PROVIDER_ERROR_MESSAGES } from "@/lib/ai/types";
import { DISCOVERY_PROVIDER_IDS } from "@/lib/discovery/types";
import { decryptSecret, encryptSecret, hasEncryptionKey, redactSecrets, secretHint } from "@/lib/security/crypto";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { getDiscoveryAdapter } from "../providers";
import { authorize } from "../session";
import { run, UserFacingError, type ActionResult } from "../result";
import { logAudit } from "../settings";
import { recordUsage } from "../usage";

const kindSchema = z.enum(["ai", "discovery"]);
const providerFor = (kind: "ai" | "discovery") =>
  kind === "ai" ? z.enum(AI_PROVIDER_IDS) : z.enum(DISCOVERY_PROVIDER_IDS);

const saveSchema = z.object({
  kind: kindSchema,
  provider: z.string(),
  apiKey: z.string().trim().max(500).optional(),
  model: z.string().trim().max(200).optional(),
  enabled: z.boolean(),
});

async function ensureRow(db: AdminClient, kind: "ai" | "discovery", provider: string) {
  const { data } = await db.from("provider_configs").select("*").eq("kind", kind).eq("provider", provider).maybeSingle();
  if (data) return data;
  const { data: created, error } = await db.from("provider_configs").insert({ kind, provider }).select("*").single();
  if (error) throw new Error(error.message);
  return created;
}

/** Saves credentials (encrypted server-side), model and enabled state. The key never returns to the client. */
export async function saveProviderConfig(input: z.infer<typeof saveSchema>): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize("integrations.manage");
    const data = saveSchema.parse(input);
    const provider = providerFor(data.kind).parse(data.provider);
    if (data.apiKey && !hasEncryptionKey()) {
      throw new UserFacingError("CREDENTIALS_ENCRYPTION_KEY is not configured on the server, so credentials can't be stored securely.");
    }
    const db = createAdminClient();
    const row = await ensureRow(db, data.kind, provider);
    const patch: TablesUpdate<"provider_configs"> = { is_enabled: data.enabled, updated_by: user.id };
    if (data.model !== undefined) patch.model = data.model || null;
    if (data.apiKey) {
      patch.encrypted_secret = encryptSecret(data.apiKey);
      patch.secret_hint = secretHint(data.apiKey);
      patch.status = "configured";
      patch.last_error = null;
      patch.last_tested_at = null;
    }
    const hasSecret = Boolean(data.apiKey || row.encrypted_secret);
    if (data.enabled && !hasSecret) throw new UserFacingError("Add an API key before enabling this provider.");
    if (data.enabled && data.kind === "ai" && !(data.model ?? row.model)) throw new UserFacingError("Select a model before enabling this provider.");
    // First enabled AI provider becomes the default automatically.
    if (data.kind === "ai" && data.enabled) {
      const { count } = await db.from("provider_configs").select("id", { count: "exact", head: true }).eq("kind", "ai").eq("is_default", true);
      if (!count) patch.is_default = true;
    }
    if (!data.enabled) patch.is_default = false;
    const { error } = await db.from("provider_configs").update(patch).eq("id", row.id);
    if (error) throw new Error(error.message);
    await logAudit(db, {
      actorId: user.id, action: "provider.save", entityType: "provider_config", entityId: row.id,
      details: { kind: data.kind, provider, key_replaced: Boolean(data.apiKey), enabled: data.enabled, model: data.model ?? null },
    });
    return undefined;
  }, "Provider settings saved.");
}

export async function removeProviderCredential(kind: "ai" | "discovery", provider: string): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize("integrations.manage");
    const db = createAdminClient();
    const { error } = await db
      .from("provider_configs")
      .update({ encrypted_secret: null, secret_hint: null, status: "unconfigured", is_enabled: false, is_default: false, last_error: null, updated_by: user.id })
      .eq("kind", kindSchema.parse(kind))
      .eq("provider", provider);
    if (error) throw new Error(error.message);
    await logAudit(db, { actorId: user.id, action: "provider.remove_credential", details: { kind, provider } });
    return undefined;
  }, "Credential removed.");
}

export async function setDefaultAIProvider(provider: string): Promise<ActionResult> {
  return run(async () => {
    const user = await authorize("integrations.manage");
    const id = z.enum(AI_PROVIDER_IDS).parse(provider);
    const db = createAdminClient();
    const { data: row } = await db.from("provider_configs").select("id, is_enabled, model, encrypted_secret").eq("kind", "ai").eq("provider", id).maybeSingle();
    if (!row?.is_enabled || !row.encrypted_secret || !row.model) throw new UserFacingError("Enable the provider with a key and model first.");
    await db.from("provider_configs").update({ is_default: false }).eq("kind", "ai").eq("is_default", true);
    const { error } = await db.from("provider_configs").update({ is_default: true }).eq("id", row.id);
    if (error) throw new Error(error.message);
    await logAudit(db, { actorId: user.id, action: "provider.set_default", details: { provider: id } });
    return undefined;
  }, "Default AI provider updated.");
}

/**
 * Tests the stored (or a newly typed, unsaved) key against the provider. AI tests list models;
 * the result is persisted as the provider's verification status.
 */
export async function testProviderConnection(kind: "ai" | "discovery", provider: string, apiKey?: string): Promise<ActionResult<{ models: string[]; message: string }>> {
  return run(async () => {
    const user = await authorize("integrations.manage");
    const k = kindSchema.parse(kind);
    const id = providerFor(k).parse(provider);
    const db = createAdminClient();
    const row = await ensureRow(db, k, id);
    const key = apiKey?.trim() || (row.encrypted_secret ? decryptSecret(row.encrypted_secret) : "");
    if (!key) throw new UserFacingError("Enter an API key to test.");
    try {
      let models: string[] = [];
      let message: string;
      if (k === "ai") {
        const res = await getAIAdapter(id as (typeof AI_PROVIDER_IDS)[number]).testConnection(key);
        models = res.models;
        message = res.message;
      } else {
        const res = await getDiscoveryAdapter(id as (typeof DISCOVERY_PROVIDER_IDS)[number]).testConnection(key);
        message = res.message;
        await recordUsage(db, { kind: "discovery", provider: id, operation: "connection_test", userId: user.id, success: true });
      }
      // Only mark verified when the stored key is the one that was tested.
      if (!apiKey?.trim() || (row.encrypted_secret && decryptSecret(row.encrypted_secret) === key)) {
        await db.from("provider_configs").update({ status: "verified", last_tested_at: new Date().toISOString(), last_error: null, settings: { ...((row.settings ?? {}) as Record<string, unknown>), models: models.slice(0, 300) } as never }).eq("id", row.id);
      }
      await logAudit(db, { actorId: user.id, action: "provider.test", details: { kind: k, provider: id, ok: true } });
      return { models, message };
    } catch (err) {
      const msg = err instanceof ProviderError ? `${PROVIDER_ERROR_MESSAGES[err.code]} ${redactSecrets(err.message, [key])}` : "Connection failed.";
      if (!apiKey?.trim()) {
        await db.from("provider_configs").update({ status: "error", last_tested_at: new Date().toISOString(), last_error: msg.slice(0, 500) }).eq("id", row.id);
      }
      await logAudit(db, { actorId: user.id, action: "provider.test", details: { kind: k, provider: id, ok: false } });
      throw new UserFacingError(msg);
    }
  });
}
