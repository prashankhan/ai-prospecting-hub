"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Check, ClipboardCopy, ExternalLink, History, PenLine, RefreshCw, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { useAction } from "@/hooks/use-action";
import { isPostContact, type OutreachStatus } from "@/lib/domain/outreach";
import { formatRelative } from "@/lib/utils";
import { approveDraft, generateMessage, logProfileOpened, markContacted, saveDraftEdit } from "@/server/actions/outreach";
import type { Draft } from "@/components/prospects/types";

export interface ComposerHandle {
  copyAndOpen: () => void;
  edit: () => void;
}

interface Props {
  prospectId: string;
  status: OutreachStatus;
  doNotContact: boolean;
  instagramUrl: string | null;
  instagramStatus: string;
  drafts: Draft[];
  onContacted?: () => void;
}

const DRAFT_STATUS: Record<string, { label: string; tone: "warning" | "accent" | "neutral" | "info" }> = {
  draft: { label: "Draft", tone: "neutral" },
  ready_for_review: { label: "Awaiting review", tone: "warning" },
  approved: { label: "Approved", tone: "accent" },
  superseded: { label: "Superseded", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
};

export const MessageComposer = forwardRef<ComposerHandle, Props>(function MessageComposer(
  { prospectId, status, doNotContact, instagramUrl, instagramStatus, drafts, onContacted },
  ref,
) {
  const current = drafts.find((d) => d.status === "ready_for_review" || d.status === "draft") ?? drafts.find((d) => d.status === "approved") ?? null;
  const approved = drafts.find((d) => d.status === "approved") ?? null;
  const sent = drafts.find((d) => d.status === "sent") ?? null;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(current?.body ?? "");
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setBody(current?.body ?? "");
    setEditing(false);
  }, [current?.id, current?.body]);

  const generate = useAction(generateMessage);
  const save = useAction(saveDraftEdit, { onSuccess: () => setEditing(false) });
  const approve = useAction(approveDraft);
  const contacted = useAction(markContacted, { onSuccess: () => { setConfirmOpen(false); setConfirmed(false); onContacted?.(); } });

  const contactedAlready = isPostContact(status);
  const blocked = doNotContact || status === "do_not_contact";
  const verified = instagramStatus === "verified" && Boolean(instagramUrl);
  const canCopyOpen = Boolean(approved) && verified && !blocked && !contactedAlready;

  const copyAndOpen = async () => {
    if (!approved || !instagramUrl) return;
    if (!verified) {
      toast.error("Verify the Instagram profile before opening it for outreach.");
      return;
    }
    // Start the clipboard write and open the tab inside the same user gesture.
    const copy = navigator.clipboard?.writeText(approved.body);
    window.open(instagramUrl, "_blank", "noopener,noreferrer");
    void logProfileOpened(prospectId);
    try {
      if (!copy) throw new Error("Clipboard unavailable");
      await copy;
      toast.success("Message copied. Paste it into Instagram, send it yourself, then mark contacted.", { duration: 6000 });
    } catch {
      setFallbackOpen(true);
    }
  };

  useImperativeHandle(ref, () => ({
    copyAndOpen: () => void copyAndOpen(),
    edit: () => { if (!blocked && !contactedAlready) setEditing(true); },
  }));

  if (blocked) {
    return <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">This business is on the do-not-contact list. Messaging is disabled.</p>;
  }

  if (contactedAlready) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Outreach was sent manually. Record replies and outcomes with the status control.</p>
        {sent && <blockquote className="rounded-md border border-border bg-surface-muted/50 px-3 py-2 text-sm whitespace-pre-wrap">{sent.body}</blockquote>}
      </div>
    );
  }

  const meta = (current?.metadata ?? {}) as { personalization?: { detail: string; source_ref: string }[] };
  const ds = current ? DRAFT_STATUS[current.status] : null;

  return (
    <div className="flex flex-col gap-3">
      {!current ? (
        <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border px-4 py-5">
          <p className="text-sm text-muted-foreground">No message yet. The agent writes a short, personalized draft using this project&apos;s messaging settings and recorded facts only.</p>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" loading={generate.pending} onClick={() => generate.execute(prospectId)}><Sparkles /> Generate message</Button>
            <Button size="sm" onClick={() => { setBody(""); setEditing(true); }}><PenLine /> Write manually</Button>
          </div>
        </div>
      ) : null}

      {(current || editing) && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {ds && <Badge tone={ds.tone}>{ds.label}</Badge>}
            {current && <span className="text-xs text-muted-foreground">v{current.version} · {current.origin === "ai" ? `AI (${current.model})` : "Written by a team member"} · {formatRelative(current.created_at)}</span>}
            {drafts.length > 1 && (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setHistoryOpen(true)}><History /> History ({drafts.length})</Button>
            )}
          </div>
          {editing ? (
            <Textarea
              autoFocus
              aria-label="Message"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              maxLength={4000}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setEditing(false); setBody(current?.body ?? ""); }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save.execute(prospectId, body); }
              }}
            />
          ) : (
            <div className="rounded-md border border-border bg-surface px-3 py-2.5 text-md leading-relaxed whitespace-pre-wrap">{current?.body}</div>
          )}
          <div className="flex items-center justify-between text-xs text-subtle-foreground">
            <span>{(editing ? body : current?.body ?? "").length} characters</span>
            {editing && <span>⌘/Ctrl + Enter to save · Esc to cancel</span>}
          </div>
          {!editing && meta.personalization && meta.personalization.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {meta.personalization.map((p, i) => (
                <li key={i}><Badge tone="outline" title={`Source ${p.source_ref}`}>{p.source_ref} · {p.detail}</Badge></li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(current || editing) && (
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button size="sm" variant="primary" loading={save.pending} disabled={!body.trim()} onClick={() => save.execute(prospectId, body)}>Save message</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setBody(current?.body ?? ""); }}>Cancel</Button>
            </>
          ) : (
            <>
              {current && current.status !== "approved" && (
                <Button size="sm" variant="primary" loading={approve.pending} onClick={() => approve.execute(current.id)}><Check /> Approve</Button>
              )}
              <Button size="sm" onClick={() => setEditing(true)}><PenLine /> Edit</Button>
              <Button size="sm" variant="ghost" loading={generate.pending} onClick={() => generate.execute(prospectId)}><RefreshCw /> Regenerate</Button>
            </>
          )}
        </div>
      )}

      {!editing && approved && (
        <div className="flex flex-col gap-2 rounded-md border border-accent/25 bg-accent-soft/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip content={verified ? "Copies the approved message and opens the verified profile in a new tab" : "Verify the Instagram profile first"}>
              <span>
                <Button variant="primary" disabled={!canCopyOpen} onClick={copyAndOpen}><ClipboardCopy /> Copy &amp; open Instagram <ExternalLink className="opacity-70" /></Button>
              </span>
            </Tooltip>
            <Button onClick={() => setConfirmOpen(true)}><Send /> Mark contacted</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Instagram doesn&apos;t allow pre-filled messages. Paste the copied text into a DM and send it yourself. Opening the profile does not mark the prospect as contacted.
          </p>
        </div>
      )}

      <Dialog open={fallbackOpen} onOpenChange={setFallbackOpen}>
        <DialogContent onOpenAutoFocus={(e) => { e.preventDefault(); fallbackRef.current?.select(); }}>
          <DialogHeader>
            <DialogTitle>Copy the message manually</DialogTitle>
            <DialogDescription>Your browser blocked clipboard access. The text is selected — press ⌘C or Ctrl+C.</DialogDescription>
          </DialogHeader>
          <Textarea ref={fallbackRef} readOnly value={approved?.body ?? ""} rows={7} onFocus={(e) => e.currentTarget.select()} />
          <DialogFooter>
            {instagramUrl && <Button asChild><a href={instagramUrl} target="_blank" rel="noreferrer noopener"><ExternalLink /> Open profile</a></Button>}
            <Button variant="primary" onClick={() => setFallbackOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={(o) => { setConfirmOpen(o); if (!o) setConfirmed(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm manual outreach</DialogTitle>
            <DialogDescription>Only mark contacted after you have sent the approved message yourself. This can&apos;t be undone and blocks repeat outreach.</DialogDescription>
          </DialogHeader>
          {approved && <blockquote className="max-h-40 overflow-y-auto rounded-md border border-border bg-surface-muted/50 px-3 py-2 text-sm whitespace-pre-wrap">{approved.body}</blockquote>}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={confirmed} onCheckedChange={(c) => setConfirmed(c === true)} className="mt-0.5" />
            I sent this message manually.
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!confirmed || !approved} loading={contacted.pending} onClick={() => approved && contacted.execute(prospectId, approved.id, true)}>Mark contacted</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Message history</DialogTitle>
            <DialogDescription>Every version is kept, including superseded drafts.</DialogDescription>
          </DialogHeader>
          <ol className="flex max-h-[60dvh] flex-col gap-3 overflow-y-auto">
            {drafts.map((d) => (
              <li key={d.id} className="rounded-md border border-border p-3">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">v{d.version}</span>
                  <Badge tone={DRAFT_STATUS[d.status]?.tone ?? "neutral"}>{DRAFT_STATUS[d.status]?.label ?? d.status}</Badge>
                  <span>{d.origin === "ai" ? `AI · ${d.model}` : "Manual"}</span>
                  <span className="ml-auto">{formatRelative(d.created_at)}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{d.body}</p>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  );
});
