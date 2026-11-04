import { DuplicatePolicyForm } from "@/components/settings/duplicate-policy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatNumber } from "@/lib/utils";
import { getWorkspaceSettings } from "@/server/settings";
import { requireAdmin } from "@/server/session";

export const metadata = { title: "Duplicate prevention" };

export default async function DuplicatesPage() {
  await requireAdmin();
  const db = createAdminClient();
  const [{ policy }, identities, keys, suppressed, pending] = await Promise.all([
    getWorkspaceSettings(db),
    db.from("business_identities").select("id", { count: "exact", head: true }),
    db.from("identity_keys").select("id", { count: "exact", head: true }),
    db.from("suppression_records").select("id", { count: "exact", head: true }),
    db.from("ambiguous_matches").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const stats = [
    { label: "Known businesses", value: identities.count },
    { label: "Identity keys", value: keys.count },
    { label: "Do-not-contact records", value: suppressed.count },
    { label: "Matches awaiting review", value: pending.count },
  ];
  return (
    <>
      <Card>
        <CardHeader className="flex-col gap-0.5">
          <CardTitle>How duplicates are prevented</CardTitle>
          <CardDescription>Enforced by database constraints and transactional locks — not by AI prompting.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <ul className="grid gap-1.5 text-muted-foreground">
            <li>• Instagram usernames, website domains, phone numbers and Google place IDs are normalized and stored as unique identity keys.</li>
            <li>• Each business can appear only once per project. The same business may be a separate prospect in other projects.</li>
            <li>• Uncertain matches (same name and location, shared contact with a different name, conflicting identifiers) are never merged automatically.</li>
            <li>• Concurrent imports and discovery jobs are serialized per identity key, so parallel runs can&apos;t create duplicates.</li>
          </ul>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-md border border-border px-3 py-2">
                <dt className="text-xs text-muted-foreground">{s.label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatNumber(s.value)}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <DuplicatePolicyForm policy={policy} />
    </>
  );
}
