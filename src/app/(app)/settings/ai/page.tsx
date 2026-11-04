import { EncryptionNotice } from "@/components/settings/env-notice";
import { ProviderCard } from "@/components/settings/provider-card";
import { UsageLimitsCard } from "@/components/settings/usage-limits";
import { AI_PROVIDERS } from "@/lib/ai/types";
import { hasEncryptionKey } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { listProviderConfigs } from "@/server/providers";
import { getWorkspaceSettings } from "@/server/settings";
import { requireAdmin } from "@/server/session";
import { usageToday } from "@/server/usage";

export const metadata = { title: "AI providers" };

export default async function AISettingsPage() {
  await requireAdmin();
  const db = createAdminClient();
  const [configs, { limits }, used] = await Promise.all([listProviderConfigs(db, "ai"), getWorkspaceSettings(db), usageToday(db, "ai")]);
  const encryptionReady = hasEncryptionKey();
  return (
    <>
      {!encryptionReady && <EncryptionNotice />}
      <p className="text-sm text-muted-foreground">
        The default provider runs qualification and message generation. A provider is only marked verified after a successful connection test with its stored key.
        Project-level AI instructions are configured on each project.
      </p>
      {AI_PROVIDERS.map((p) => (
        <ProviderCard
          key={p.id}
          kind="ai"
          id={p.id}
          label={p.label}
          description={p.description}
          keyPlaceholder={p.keyPlaceholder}
          keyHelpUrl={p.keyHelpUrl}
          needsModel
          config={configs.find((c) => c.provider === p.id) ?? null}
          encryptionReady={encryptionReady}
        />
      ))}
      <UsageLimitsCard
        title="AI usage limits"
        description="Hard caps that protect against unexpected AI spend."
        limits={limits}
        fields={["ai_daily_requests", "ai_batch_size", "max_concurrent_jobs"]}
        usedToday={{ label: "AI requests today", used, cap: limits.ai_daily_requests }}
      />
    </>
  );
}
