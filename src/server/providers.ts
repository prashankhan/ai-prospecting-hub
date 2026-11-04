import "server-only";
import { getAIAdapter } from "@/lib/ai/providers";
import { AI_PROVIDER_IDS, ProviderError, type AIProviderAdapter, type AIProviderId } from "@/lib/ai/types";
import { createGooglePlacesAdapter } from "@/lib/discovery/providers/google-places";
import type { DiscoveryAdapter, DiscoveryProviderId } from "@/lib/discovery/types";
import { getWebSearchAdapter, type WebSearchProviderId } from "@/lib/discovery/web/providers";
import { decryptSecret } from "@/lib/security/crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/supabase/database.types";

/** Fields that may be sent to the browser. The encrypted secret is never included. */
export type SafeProviderConfig = Omit<Tables<"provider_configs">, "encrypted_secret"> & { has_secret: boolean };

const SAFE_COLUMNS =
  "id, kind, provider, model, secret_hint, is_enabled, is_default, status, last_tested_at, last_error, settings, updated_by, created_at, updated_at, encrypted_secret";

export async function listProviderConfigs(db: AdminClient, kind: "ai" | "discovery"): Promise<SafeProviderConfig[]> {
  const { data } = await db.from("provider_configs").select(SAFE_COLUMNS).eq("kind", kind);
  return (data ?? []).map(({ encrypted_secret, ...rest }) => ({ ...rest, has_secret: Boolean(encrypted_secret) }));
}

export interface ActiveAI {
  provider: AIProviderId;
  model: string;
  apiKey: string;
  adapter: AIProviderAdapter;
}

/** The default, enabled AI provider with a decrypted key — server-only, never serialized. */
export async function getActiveAI(db: AdminClient): Promise<ActiveAI> {
  const { data } = await db
    .from("provider_configs")
    .select("provider, model, encrypted_secret, is_enabled")
    .eq("kind", "ai")
    .eq("is_default", true)
    .maybeSingle();
  if (!data || !data.is_enabled || !data.encrypted_secret || !data.model) {
    throw new ProviderError("ai", "not_configured", "Configure and enable a default AI provider in Settings → AI providers.");
  }
  if (!(AI_PROVIDER_IDS as readonly string[]).includes(data.provider)) {
    throw new ProviderError(data.provider, "not_configured", "Unsupported AI provider.");
  }
  const provider = data.provider as AIProviderId;
  return { provider, model: data.model, apiKey: decryptSecret(data.encrypted_secret), adapter: getAIAdapter(provider) };
}

export function getDiscoveryAdapter(id: DiscoveryProviderId): DiscoveryAdapter {
  switch (id) {
    case "google_places":
      return createGooglePlacesAdapter();
  }
}

export async function getDiscoveryCredentials(db: AdminClient, id: DiscoveryProviderId) {
  const { data } = await db
    .from("provider_configs")
    .select("encrypted_secret, is_enabled, status")
    .eq("kind", "discovery")
    .eq("provider", id)
    .maybeSingle();
  if (!data?.encrypted_secret || !data.is_enabled) {
    throw new ProviderError(id, "not_configured", "This discovery provider is not configured or is disabled.");
  }
  return { apiKey: decryptSecret(data.encrypted_secret), adapter: getDiscoveryAdapter(id) };
}

/**
 * Credentials for a web-search discovery provider. Gemini search reuses the stored Gemini AI
 * key and model; the others have their own encrypted key.
 */
export async function getWebSearchCredentials(db: AdminClient, id: WebSearchProviderId, opts: { requireEnabled?: boolean } = {}) {
  const { requireEnabled = true } = opts;
  const { data: row } = await db
    .from("provider_configs")
    .select("encrypted_secret, is_enabled")
    .eq("kind", "discovery")
    .eq("provider", id)
    .maybeSingle();
  if (requireEnabled && !row?.is_enabled) {
    throw new ProviderError(id, "not_configured", "This discovery provider is disabled. Enable it in Settings → Discovery providers.");
  }
  if (id === "gemini_search") {
    const { data: ai } = await db
      .from("provider_configs")
      .select("encrypted_secret, model")
      .eq("kind", "ai")
      .eq("provider", "gemini")
      .maybeSingle();
    if (!ai?.encrypted_secret || !ai.model) {
      throw new ProviderError(id, "not_configured", "Gemini search needs a Gemini key and model in Settings → AI providers.");
    }
    return { cred: { apiKey: decryptSecret(ai.encrypted_secret), model: ai.model }, adapter: getWebSearchAdapter(id) };
  }
  if (!row?.encrypted_secret) {
    throw new ProviderError(id, "not_configured", "Add an API key for this provider in Settings → Discovery providers.");
  }
  return { cred: { apiKey: decryptSecret(row.encrypted_secret) }, adapter: getWebSearchAdapter(id) };
}
