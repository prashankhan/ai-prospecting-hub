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
        Discovery providers find businesses. No scraping of Instagram, logins or access-control bypassing is used; Instagram profiles are identified from links businesses publish on their own websites.
      </p>
      {DISCOVERY_PROVIDERS.map((p) =>
        p.id === "google_places" ? (
          <ProviderCard
            key={p.id}
            kind="discovery"
            id={p.id}
            label={p.label}
            description={p.description}
            keyHelpUrl={p.keyHelpUrl}
            keyPlaceholder="AIza…"
            needsModel={false}
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
