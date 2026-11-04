"use client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { formatDateTime } from "@/lib/utils";
import { resolveAmbiguousMatch } from "@/server/actions/jobs";

const REASONS: Record<string, string> = {
  same_name_and_location: "Same name and location as a known business, but no shared identifier.",
  shared_contact_different_name: "Shares a website or phone with a known business that has a different name.",
  conflicting_identifiers: "Shares an identifier with a known business that has a different Instagram account or place.",
  keys_match_multiple_identities: "Its identifiers belong to more than one known business.",
  known_identity_global_detection_disabled: "Known in another project while global detection is off for this project.",
};

export interface MatchRow {
  id: string;
  reason: string;
  created_at: string;
  candidate: { business_name?: string; city?: string | null; country?: string | null; website?: string | null; instagram_username?: string | null; phone?: string | null; source?: string; keys?: { type: string; value: string }[] };
  candidates: { identityId: string; prospect: { id: string; business_name: string; city: string | null; website: string | null; instagram_username: string | null } | null }[];
}

function MatchCard({ m }: { m: MatchRow }) {
  const { execute, pending } = useAction(resolveAmbiguousMatch);
  const c = m.candidate;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{c.business_name}</p>
          <p className="text-sm text-muted-foreground">{[c.city, c.country].filter(Boolean).join(", ")}{c.source && ` · from ${c.source === "google_places" ? "Google Places" : c.source}`}</p>
        </div>
        <span className="text-xs text-muted-foreground">{formatDateTime(m.created_at)}</span>
      </div>
      <p className="text-sm">{REASONS[m.reason] ?? m.reason}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <p className="mb-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase">Incoming record</p>
          <ul className="text-sm">
            {c.website && <li>Website: {c.website}</li>}
            {c.instagram_username && <li>Instagram: @{c.instagram_username}</li>}
            {c.phone && <li>Phone: {c.phone}</li>}
            {(c.keys ?? []).map((k) => <li key={`${k.type}${k.value}`} className="text-xs text-muted-foreground">{k.type}: {k.value}</li>)}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          {m.candidates.map((cand) => (
            <div key={cand.identityId} className="rounded-md border border-border p-3">
              <p className="mb-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase">Possible match</p>
              {cand.prospect ? (
                <ul className="text-sm">
                  <li className="font-medium">{cand.prospect.business_name}</li>
                  {cand.prospect.city && <li>{cand.prospect.city}</li>}
                  {cand.prospect.website && <li>Website: {cand.prospect.website}</li>}
                  {cand.prospect.instagram_username && <li>Instagram: @{cand.prospect.instagram_username}</li>}
                </ul>
              ) : <p className="text-sm text-muted-foreground">A business known in another project. Details are hidden for privacy.</p>}
              <Button size="sm" className="mt-2" loading={pending} onClick={() => execute(m.id, "existing", cand.identityId)}>Same business</Button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button size="sm" variant="primary" loading={pending} onClick={() => execute(m.id, "separate")}>Different business — add as new</Button>
        <Button size="sm" variant="ghost" loading={pending} onClick={() => execute(m.id, "dismiss")}>Dismiss record</Button>
        <Badge tone="outline" className="ml-auto self-center">Never merged automatically</Badge>
      </div>
    </Card>
  );
}

export function MatchReview({ matches }: { matches: MatchRow[] }) {
  return <div className="flex flex-col gap-3">{matches.map((m) => <MatchCard key={m.id} m={m} />)}</div>;
}
