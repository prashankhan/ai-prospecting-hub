"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Ban, ChevronLeft, ChevronRight, MessageSquareText, Sparkles, Trash2, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import { Confirm } from "@/components/app/confirm";
import { InstagramStatusBadge, OutreachStatusBadge, QualificationBadge, ScorePill } from "@/components/app/status-badges";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { OUTREACH_STATUS_LABELS, POST_CONTACT, type OutreachStatus } from "@/lib/domain/outreach";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { startBatchJob } from "@/server/actions/jobs";
import { assignProspects, changeStatus, deleteProspects, markDoNotContact } from "@/server/actions/prospects";

export interface ProspectRow {
  id: string;
  business_name: string;
  category: string | null;
  city: string | null;
  country: string | null;
  instagram_username: string | null;
  instagram_match_status: string;
  qualification_score: number | null;
  qualification_status: string;
  outreach_status: OutreachStatus;
  assigned_to: string | null;
  source: string;
  discovered_at: string;
  last_contacted_at: string | null;
}

function SortHeader({ label, field, className }: { label: string; field: string; className?: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const sort = params.get("sort") ?? "created_at";
  const dir = params.get("dir") ?? "desc";
  const next = new URLSearchParams(params.toString());
  next.set("sort", field);
  next.set("dir", sort === field && dir === "desc" ? "asc" : "desc");
  next.delete("page");
  return (
    <TH className={className} aria-sort={sort === field ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={`${pathname}?${next}`} scroll={false} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {sort === field && (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </Link>
    </TH>
  );
}

function DncDialogButton({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [global, setGlobal] = useState(true);
  const { execute } = useAction(markDoNotContact, { onSuccess: onDone });
  return (
    <Confirm
      destructive
      trigger={<Button size="sm" variant="ghost"><Ban /> Do not contact</Button>}
      title={`Mark ${ids.length} prospect${ids.length === 1 ? "" : "s"} do not contact?`}
      description="They'll be removed from outreach queues and skipped in future discovery. Only administrators can lift this."
      confirmLabel="Mark do not contact"
      onConfirm={() => execute(ids, reason, global)}
    >
      <div className="flex flex-col gap-3">
        <Input aria-label="Reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Apply to all projects<span className="block text-xs text-muted-foreground">Recommended when the business asked not to be contacted.</span></span>
          <Switch checked={global} onCheckedChange={setGlobal} />
        </label>
      </div>
    </Confirm>
  );
}

export function ProspectTable({ rows, total, page, pageSize, members, projectId, isAdmin }: { rows: ProspectRow[]; total: number; page: number; pageSize: number; members: { id: string; name: string }[]; projectId: string; isAdmin: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const clear = () => setSelected(new Set());
  const ids = [...selected];
  const memberName = new Map(members.map((m) => [m.id, m.name]));

  const assign = useAction(assignProspects, { onSuccess: clear, success: (d) => `Assigned ${d.count} prospect${d.count === 1 ? "" : "s"}.` });
  const status = useAction(changeStatus, { onSuccess: clear, success: (d) => `Updated ${d.updated}${d.skipped ? `, skipped ${d.skipped} not eligible` : ""}.` });
  const remove = useAction(deleteProspects, { onSuccess: clear, success: (d) => `Deleted ${d.count}.` });
  const batch = useAction(startBatchJob, {
    onSuccess: (d) => { clear(); router.push(`/discover/jobs/${d.jobId}`); },
    success: (d) => `Queued ${d.queued}${d.excluded ? ` (${d.excluded} not eligible)` : ""}.`,
    refresh: false,
  });

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someChecked = rows.some((r) => selected.has(r.id));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (p: number) => {
    const n = new URLSearchParams(params.toString());
    n.set("page", String(p));
    return `${pathname}?${n}`;
  };

  return (
    <div className="flex flex-col">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-accent-soft/50 px-3 py-1.5" role="toolbar" aria-label="Bulk actions">
          <span className="mr-2 text-sm font-medium">{selected.size} selected</span>
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" loading={assign.pending}><UserRoundCheck /> Assign</Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Assign to</DropdownMenuLabel>
                {members.map((m) => <DropdownMenuItem key={m.id} onSelect={() => assign.execute(ids, m.id)}>{m.name}</DropdownMenuItem>)}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => assign.execute(ids, null)}>Unassign</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" loading={status.pending}>Set status</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Record outcome</DropdownMenuLabel>
              {POST_CONTACT.filter((s) => s !== "contacted").map((s) => (
                <DropdownMenuItem key={s} onSelect={() => status.execute(ids, s)}>{OUTREACH_STATUS_LABELS[s]}</DropdownMenuItem>
              ))}
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Only applies to prospects already contacted.</p>
            </DropdownMenuContent>
          </DropdownMenu>
          {isAdmin && (
            <>
              <Confirm
                trigger={<Button size="sm" variant="ghost" loading={batch.pending}><Sparkles /> Qualify</Button>}
                title={`Qualify ${ids.length} prospect${ids.length === 1 ? "" : "s"} with AI?`}
                description={<>This runs website research and up to {ids.length * 2} AI requests against your daily limit. Prospects already assessed are skipped unless automatic reprocessing is on.</>}
                confirmLabel="Start qualification"
                onConfirm={() => batch.execute(projectId, "qualification", ids)}
              />
              <Confirm
                trigger={<Button size="sm" variant="ghost" loading={batch.pending}><MessageSquareText /> Generate messages</Button>}
                title={`Generate drafts for ${ids.length} prospect${ids.length === 1 ? "" : "s"}?`}
                description="Each draft uses up to 2 AI requests and must be reviewed before anyone sends it. Nothing is sent automatically."
                confirmLabel="Generate drafts"
                onConfirm={() => batch.execute(projectId, "message_generation", ids)}
              />
            </>
          )}
          <DncDialogButton ids={ids} onDone={clear} />
          {isAdmin && (
            <Confirm
              destructive
              trigger={<Button size="sm" variant="danger-ghost"><Trash2 /> Delete</Button>}
              title={`Delete ${ids.length} prospect${ids.length === 1 ? "" : "s"}?`}
              description="Removes them from this project with their drafts, notes and activity. The business stays known globally, so rediscovery will show it as already known."
              confirmLabel="Delete"
              onConfirm={() => remove.execute(ids)}
            />
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={clear}>Clear selection</Button>
        </div>
      )}
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH className="w-9 pr-0">
              <Checkbox
                aria-label="Select all on this page"
                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                onCheckedChange={(c) => setSelected(c ? new Set(rows.map((r) => r.id)) : new Set())}
              />
            </TH>
            <SortHeader label="Business" field="business_name" />
            <SortHeader label="Location" field="city" />
            <TH>Instagram</TH>
            <SortHeader label="Score" field="qualification_score" />
            <TH>Qualification</TH>
            <TH>Outreach</TH>
            <TH>Assigned</TH>
            <SortHeader label="Discovered" field="created_at" />
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id} data-selected={selected.has(r.id)}>
              <TD className="pr-0">
                <Checkbox
                  aria-label={`Select ${r.business_name}`}
                  checked={selected.has(r.id)}
                  onCheckedChange={(c) => setSelected((s) => { const n = new Set(s); if (c) n.add(r.id); else n.delete(r.id); return n; })}
                />
              </TD>
              <TD className="max-w-72">
                <Link href={`/prospects/${r.id}`} className="block truncate font-medium hover:text-accent">{r.business_name}</Link>
                <span className="block truncate text-xs text-muted-foreground">{r.category ?? r.source}</span>
              </TD>
              <TD className="whitespace-nowrap text-muted-foreground">{[r.city, r.country].filter(Boolean).join(", ") || "—"}</TD>
              <TD>
                <div className="flex flex-col items-start gap-0.5">
                  {r.instagram_username && <span className="text-xs">@{r.instagram_username}</span>}
                  <InstagramStatusBadge status={r.instagram_match_status} />
                </div>
              </TD>
              <TD><ScorePill score={r.qualification_score} /></TD>
              <TD><QualificationBadge status={r.qualification_status} /></TD>
              <TD><OutreachStatusBadge status={r.outreach_status} /></TD>
              <TD className="whitespace-nowrap text-muted-foreground">{r.assigned_to ? memberName.get(r.assigned_to) ?? "Team member" : "—"}</TD>
              <TD className="whitespace-nowrap text-muted-foreground">{formatDate(r.discovered_at)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm text-muted-foreground">
        <span>{formatNumber(total)} prospect{total === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-2">
          <span>Page {page} of {pages}</span>
          <Button size="icon-sm" variant="ghost" asChild={page > 1} disabled={page <= 1} aria-label="Previous page" className={cn(page <= 1 && "opacity-40")}>
            {page > 1 ? <Link href={pageHref(page - 1)} scroll={false}><ChevronLeft /></Link> : <ChevronLeft />}
          </Button>
          <Button size="icon-sm" variant="ghost" asChild={page < pages} disabled={page >= pages} aria-label="Next page" className={cn(page >= pages && "opacity-40")}>
            {page < pages ? <Link href={pageHref(page + 1)} scroll={false}><ChevronRight /></Link> : <ChevronRight />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function copyText(text: string) {
  return navigator.clipboard.writeText(text).then(() => toast.success("Copied."), () => toast.error("Copy failed."));
}
