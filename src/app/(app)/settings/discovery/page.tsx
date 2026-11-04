import { EncryptionNotice } from "@/components/settings/env-notice";
import { ProviderCard } from "@/components/settings/provider-card";
import { UsageLimitsCard } from "@/components/settings/usage-limits";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DISCOVERY_PROVIDERS } from "@/lib/discovery/types";
import { hasEncryptionKey } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { listProviderConfigs } from "@/server/providers";
import { getWorkspaceSettings } from "@/server/settings";
import { requireAdmin } from "@/server/session";
import { usageToday } from "@/server/usage";

export const metadata = { title: "Discovery providers" };

export default async function DiscoverySettingsPage() {
  await requireAdmin();
  const db = createAdminClient();
  const [configs, { limits }, used] = await Promise.all([listProviderConfigs(db, "discovery"), getWorkspaceSettings(db), usageToday(db, "discovery")]);
  const encryptionReady = hasEncryptionKey();
  return (
    <>
      {!encryptionReady && <EncryptionNotice />}
      <p className="text-sm text-muted-foreground">
        Web search providers power the discovery agent: it searches the web, opens each business&apos;s own website, and keeps a prospect&apos;s Instagram as <strong className="font-medium text-foreground">verified</strong> only when that website links to it. Google Places is optional. Instagram itself is never scraped, logged into or messaged automatically.
      </p>
      {DISCOVERY_PROVIDERS.map((p) =>
        p.availability === "available" && p.mode !== "import" ? (
          <ProviderCard
            key={p.id}
            kind="discovery"
            id={p.id}
            label={p.label}
            description={p.description}
            keyHelpUrl={p.keyHelpUrl}
            keyPlaceholder={p.keyPlaceholder}
            needsModel={false}
            noKey={p.usesGeminiKey}
            recommended={p.recommended}
            config={configs.find((c) => c.provider === p.id) ?? null}
            encryptionReady={encryptionReady}
            notes={p.notes}
          />
        ) : (
          <Card key={p.id}>
            <CardContent className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h3 className="text-md font-semibold">{p.label}</h3>
                <Badge tone={p.availability === "available" ? "success" : "neutral"}>{p.availability === "available" ? "Always available" : "Planned"}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{p.description}</p>
              {p.notes.map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
            </CardContent>
          </Card>
        ),
      )}
      <UsageLimitsCard
        title="Discovery usage limits"
        description="Caps on paid search requests and job size."
        limits={limits}
        fields={["discovery_daily_requests", "discovery_max_results_per_job", "research_fetch_timeout_ms"]}
        usedToday={{ label: "Discovery requests today", used, cap: limits.discovery_daily_requests }}
      />
    </>
  );
}
