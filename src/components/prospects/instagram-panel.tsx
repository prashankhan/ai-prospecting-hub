"use client";
import { useState } from "react";
import { BadgeCheck, ExternalLink } from "lucide-react";
import { InstagramStatusBadge } from "@/components/app/status-badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { formatDate } from "@/lib/utils";
import { verifyInstagram } from "@/server/actions/prospects";

interface Evidence { username: string; source: string; url?: string; detail?: string; observed_at: string }

const SOURCE_LABELS: Record<string, string> = {
  business_website: "Business website",
  manual: "Manual verification",
  csv: "CSV import",
  provider: "Data provider",
  search: "Public search",
};

export function InstagramPanel({ prospectId, username, url, status, evidence }: { prospectId: string; username: string | null; url: string | null; status: string; evidence: Evidence[] }) {
  const [handle, setHandle] = useState(username ?? "");
  const [editing, setEditing] = useState(false);
  const { execute, pending } = useAction(verifyInstagram, { onSuccess: () => setEditing(false) });
  const candidates = [...new Set(evidence.map((e) => e.username))];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {username ? (
          <a href={url ?? `https://www.instagram.com/${username}/`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm font-medium hover:text-accent">
            @{username} <ExternalLink className="size-3" />
          </a>
        ) : <span className="text-sm text-muted-foreground">No profile identified</span>}
        <InstagramStatusBadge status={status} />
      </div>
      {status === "conflicting" && (
        <p className="text-sm text-muted-foreground">Different handles were found: {candidates.map((c) => `@${c}`).join(", ")}. Check them and confirm the correct one.</p>
      )}
      {status === "likely" && <p className="text-sm text-muted-foreground">Not confirmed by the business website. Open the profile, check it belongs to this business, then verify it.</p>}
      {evidence.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border border-border bg-surface-muted/40 p-2 text-xs">
          {evidence.map((e, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium">@{e.username}</span>
              <span className="text-muted-foreground">{SOURCE_LABELS[e.source] ?? e.source}</span>
              {e.url && e.source === "business_website" && <a className="truncate text-accent hover:underline" href={e.url} target="_blank" rel="noreferrer noopener">{e.url}</a>}
              <span className="ml-auto text-subtle-foreground">{formatDate(e.observed_at)}</span>
            </li>
          ))}
        </ul>
      )}
      {editing || status !== "verified" ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); execute(prospectId, handle); }}>
          <Input aria-label="Instagram username or profile URL" placeholder="@username or profile URL" value={handle} onChange={(e) => setHandle(e.target.value)} />
          <Button type="submit" loading={pending} disabled={!handle.trim()}><BadgeCheck /> Mark verified</Button>
        </form>
      ) : (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setEditing(true)}>Correct profile</Button>
      )}
    </div>
  );
}
