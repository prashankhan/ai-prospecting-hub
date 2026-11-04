import { CheckCircle2, CircleAlert } from "lucide-react";
import { SetPasswordForm } from "@/components/app/auth-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { configurationStatus } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/utils";
import { requireUser } from "@/server/session";

export const metadata = { title: "Security" };

const ENV_LABELS: Record<string, string> = {
  supabase: "Supabase project URL and anon key",
  serviceRole: "Supabase service role key (server only)",
  encryptionKey: "Credential encryption key",
  setupToken: "Initial setup token",
  cronSecret: "Background job cron secret",
};

export default async function SecurityPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  let audit: { id: number; action: string; created_at: string; actor: string | null; details: unknown }[] = [];
  let credentials: { kind: string; provider: string; status: string; secret_hint: string | null; last_tested_at: string | null }[] = [];
  if (isAdmin) {
    const db = createAdminClient();
    const [{ data: logs }, { data: creds }, { data: people }] = await Promise.all([
      db.from("audit_logs").select("id, action, created_at, actor_id, details").not("action", "eq", "prospect.ingest").order("created_at", { ascending: false }).limit(50),
      db.from("provider_configs").select("kind, provider, status, secret_hint, last_tested_at").order("kind"),
      db.from("profiles").select("id, email, full_name"),
    ]);
    const names = new Map((people ?? []).map((p) => [p.id, p.full_name ?? p.email]));
    audit = (logs ?? []).map((l) => ({ id: l.id, action: l.action, created_at: l.created_at, actor: l.actor_id ? names.get(l.actor_id) ?? "Unknown" : "System", details: l.details }));
    credentials = creds ?? [];
  }
  const env = configurationStatus();
  return (
    <>
      <Card>
        <CardHeader className="flex-col gap-0.5">
          <CardTitle>Password</CardTitle>
          <CardDescription>Change the password for {user.email}.</CardDescription>
        </CardHeader>
        <CardContent className="max-w-sm"><SetPasswordForm /></CardContent>
      </Card>
      {isAdmin && (
        <>
          <Card>
            <CardHeader className="flex-col gap-0.5">
              <CardTitle>Environment</CardTitle>
              <CardDescription>Infrastructure secrets are managed in the hosting environment and never stored in the database.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-1.5 text-sm">
                {Object.entries(env).map(([k, ok]) => (
                  <li key={k} className="flex items-center gap-2">
                    {ok ? <CheckCircle2 className="size-4 text-success" /> : <CircleAlert className="size-4 text-warning" />}
                    {ENV_LABELS[k]} <span className="text-muted-foreground">— {ok ? "configured" : "missing"}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader className="flex-col gap-0.5">
              <CardTitle>Stored credentials</CardTitle>
              <CardDescription>Encrypted with AES-256-GCM. Only the last four characters are ever displayed.</CardDescription>
            </CardHeader>
            {credentials.length === 0 ? <CardContent className="text-sm text-muted-foreground">No credentials stored.</CardContent> : (
              <Table>
                <THead><TR><TH>Type</TH><TH>Provider</TH><TH>Key</TH><TH>Status</TH><TH>Last tested</TH></TR></THead>
                <TBody>
                  {credentials.map((c) => (
                    <TR key={`${c.kind}-${c.provider}`}>
                      <TD className="capitalize">{c.kind === "ai" ? "AI" : "Discovery"}</TD>
                      <TD>{c.provider}</TD>
                      <TD className="font-mono text-xs">{c.secret_hint ?? "—"}</TD>
                      <TD className="capitalize">{c.status}</TD>
                      <TD className="text-muted-foreground">{formatDateTime(c.last_tested_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
          <Card className="overflow-hidden">
            <CardHeader className="flex-col gap-0.5">
              <CardTitle>Audit log</CardTitle>
              <CardDescription>Most recent 50 administrative and security events.</CardDescription>
            </CardHeader>
            {audit.length === 0 ? <CardContent className="text-sm text-muted-foreground">No events yet.</CardContent> : (
              <Table>
                <THead><TR><TH>When</TH><TH>Actor</TH><TH>Action</TH><TH>Details</TH></TR></THead>
                <TBody>
                  {audit.map((a) => (
                    <TR key={a.id}>
                      <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.created_at)}</TD>
                      <TD>{a.actor}</TD>
                      <TD className="font-mono text-xs">{a.action}</TD>
                      <TD className="max-w-md truncate font-mono text-xs text-muted-foreground">{JSON.stringify(a.details)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </>
  );
}
