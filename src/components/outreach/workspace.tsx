"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, ChevronRight, ExternalLink } from "lucide-react";
import { InstagramStatusBadge, OutreachStatusBadge, ScorePill } from "@/components/app/status-badges";
import { MessageComposer, type ComposerHandle } from "@/components/outreach/message-composer";
import { BusinessFacts } from "@/components/prospects/business-facts";
import { InstagramPanel } from "@/components/prospects/instagram-panel";
import { NotesPanel } from "@/components/prospects/notes-panel";
import { QualificationPanel } from "@/components/prospects/qualification-panel";
import { StatusControl } from "@/components/prospects/status-control";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OutreachStatus } from "@/lib/domain/outreach";
import { cn } from "@/lib/utils";
import type { ProspectBundle } from "@/server/queries/prospect-detail";

export interface QueueItem {
  id: string;
  business_name: string;
  city: string | null;
  country: string | null;
  instagram_username: string | null;
  qualification_score: number | null;
  outreach_status: OutreachStatus;
}

export const VIEWS = [
  { id: "ready", label: "Ready to send" },
  { id: "review", label: "Needs review" },
  { id: "todo", label: "Needs message" },
  { id: "followup", label: "Follow-ups" },
] as const;

export function OutreachWorkspace({ queue, bundle, view, scope, counts, isAdmin }: { queue: QueueItem[]; bundle: ProspectBundle | null; view: string; scope: string; counts: Record<string, number>; isAdmin: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const composer = useRef<ComposerHandle>(null);
  const selectedId = bundle?.prospect.id ?? null;
  const index = queue.findIndex((q) => q.id === selectedId);

  const href = useCallback((patch: Record<string, string | null>) => {
    const n = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) n.delete(k);
      else n.set(k, v);
    }
    return `${pathname}?${n}`;
  }, [params, pathname]);

  const go = useCallback((offset: number) => {
    if (queue.length === 0) return;
    const next = queue[Math.min(queue.length - 1, Math.max(0, (index < 0 ? 0 : index) + offset))];
    if (next && next.id !== selectedId) router.push(href({ prospect: next.id }), { scroll: false });
  }, [queue, index, selectedId, router, href]);

  const nextAfterContact = useCallback(() => {
    const remaining = queue.filter((q) => q.id !== selectedId);
    const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
    router.push(href({ prospect: next?.id ?? null }), { scroll: false });
  }, [queue, selectedId, index, router, href]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); go(1); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); go(-1); }
      else if (e.key === "c") { e.preventDefault(); composer.current?.copyAndOpen(); }
      else if (e.key === "e") { e.preventDefault(); composer.current?.edit(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const p = bundle?.prospect;
  const evidence = (p?.instagram_evidence as unknown as { username: string; source: string; url?: string; observed_at: string }[]) ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Queue">
          {VIEWS.map((v) => (
            <Link
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              href={href({ view: v.id, prospect: null })}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors", view === v.id ? "bg-surface font-medium shadow-xs ring-1 ring-border" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground")}
            >
              {v.label}
              <span className="rounded-sm bg-surface-muted px-1 text-2xs tabular-nums text-muted-foreground">{counts[v.id] ?? 0}</span>
            </Link>
          ))}
        </div>
        {isAdmin && (
          <div className="flex gap-1 text-xs">
            {[["mine", "Assigned to me"], ["all", "Everyone"]].map(([id, label]) => (
              <Link key={id} href={href({ scope: id, prospect: null })} className={cn("rounded-sm px-1.5 py-0.5", scope === id ? "bg-accent-soft text-accent-soft-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</Link>
            ))}
          </div>
        )}
        <Card className="overflow-hidden">
          {queue.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing in this queue.</p>
          ) : (
            <ul className="max-h-[calc(100dvh-14rem)] divide-y divide-border overflow-y-auto" aria-label="Prospects in queue">
              {queue.map((q) => (
                <li key={q.id}>
                  <Link
                    href={href({ prospect: q.id })}
                    scroll={false}
                    aria-current={q.id === selectedId ? "true" : undefined}
                    className={cn("flex items-center gap-2 px-3 py-2 transition-colors hover:bg-surface-hover", q.id === selectedId && "bg-accent-soft/60 hover:bg-accent-soft/60")}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{q.business_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{[q.city, q.country].filter(Boolean).join(", ") || "—"}{q.instagram_username && ` · @${q.instagram_username}`}</p>
                    </div>
                    <ScorePill score={q.qualification_score} className="text-xs" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="hidden text-xs text-subtle-foreground lg:block">
          <kbd className="rounded-sm border border-border px-1">j</kbd>/<kbd className="rounded-sm border border-border px-1">k</kbd> move ·{" "}
          <kbd className="rounded-sm border border-border px-1">c</kbd> copy &amp; open ·{" "}
          <kbd className="rounded-sm border border-border px-1">e</kbd> edit
        </p>
      </div>

      {!bundle || !p ? (
        <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">Select a prospect from the queue.</CardContent></Card>
      ) : (
        <Card className="min-w-0">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">{p.business_name}</h2>
                <OutreachStatusBadge status={p.outreach_status} />
              </div>
              <p className="text-sm text-muted-foreground">
                {[p.city, p.country].filter(Boolean).join(", ") || "Location unknown"}
                {p.instagram_username && <> · <a href={p.instagram_url ?? "#"} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 hover:text-accent">@{p.instagram_username}<ExternalLink className="size-3" /></a></>}
                {p.assigned_to && <> · {bundle.names[p.assigned_to] ?? "Assigned"}</>}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <ScorePill score={p.qualification_score} />
                <InstagramStatusBadge status={p.instagram_match_status} />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <StatusControl prospectId={p.id} status={p.outreach_status} isAdmin={isAdmin} hasApprovedDraft={bundle.drafts.some((d) => d.status === "approved")} />
              <Button size="icon-sm" variant="ghost" aria-label="Previous prospect" disabled={index <= 0} onClick={() => go(-1)}><ArrowUp /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="Next prospect" disabled={index < 0 || index >= queue.length - 1} onClick={() => go(1)}><ArrowDown /></Button>
              <Button size="sm" variant="ghost" asChild><Link href={`/prospects/${p.id}`}>Details <ChevronRight /></Link></Button>
            </div>
          </div>
          <div className="grid gap-6 px-5 py-4 xl:grid-cols-[1fr_320px]">
            <div className="flex min-w-0 flex-col gap-5">
              <section aria-labelledby="msg-h">
                <h3 id="msg-h" className="mb-2 text-2xs font-medium tracking-wide text-muted-foreground uppercase">Personalized message</h3>
                <MessageComposer
                  key={p.id}
                  ref={composer}
                  prospectId={p.id}
                  status={p.outreach_status}
                  doNotContact={p.do_not_contact}
                  instagramUrl={p.instagram_url}
                  instagramStatus={p.instagram_match_status}
                  drafts={bundle.drafts}
                  onContacted={nextAfterContact}
                />
              </section>
              <section aria-labelledby="q-h">
                <h3 id="q-h" className="mb-2 text-2xs font-medium tracking-wide text-muted-foreground uppercase">Why this prospect</h3>
                <QualificationPanel prospectId={p.id} q={bundle.qualification} status={p.qualification_status} compact />
              </section>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <Tabs defaultValue="business">
                <TabsList>
                  <TabsTrigger value="business">Business</TabsTrigger>
                  <TabsTrigger value="instagram">Instagram</TabsTrigger>
                  <TabsTrigger value="notes">Notes ({bundle.notes.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="business"><BusinessFacts p={p} /></TabsContent>
                <TabsContent value="instagram"><InstagramPanel prospectId={p.id} username={p.instagram_username} url={p.instagram_url} status={p.instagram_match_status} evidence={evidence} /></TabsContent>
                <TabsContent value="notes"><NotesPanel prospectId={p.id} notes={bundle.notes} names={bundle.names} /></TabsContent>
              </Tabs>
            </div>
          </div>
          <div className="flex justify-end border-t border-border px-5 py-3">
            <Button variant="secondary" disabled={index < 0 || index >= queue.length - 1} onClick={() => go(1)}>Next prospect <ArrowDown /></Button>
          </div>
        </Card>
      )}
    </div>
  );
}
