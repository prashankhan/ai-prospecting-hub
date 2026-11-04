"use client";
import { useState } from "react";
import { Ban, ChevronDown, Undo2 } from "lucide-react";
import { OutreachStatusBadge } from "@/components/app/status-badges";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { OUTREACH_STATUS_LABELS, RESPONSE_STATUSES, selectableStatuses, type OutreachStatus } from "@/lib/domain/outreach";
import { changeStatus, markDoNotContact } from "@/server/actions/prospects";

export function StatusControl({ prospectId, status, isAdmin, hasApprovedDraft }: { prospectId: string; status: OutreachStatus; isAdmin: boolean; hasApprovedDraft: boolean }) {
  const options = selectableStatuses(status, { isAdmin, hasApprovedDraft }).filter((s) => s !== "contacted");
  const [pendingStatus, setPendingStatus] = useState<OutreachStatus | null>(null);
  const [note, setNote] = useState("");
  const [dncOpen, setDncOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [global, setGlobal] = useState(true);
  const change = useAction(changeStatus, { success: () => "Status updated.", onSuccess: () => { setPendingStatus(null); setNote(""); } });
  const dnc = useAction(markDoNotContact, { onSuccess: () => setDncOpen(false) });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" loading={change.pending} className="gap-1">
            <OutreachStatusBadge status={status} /> <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {status === "do_not_contact" ? (
            isAdmin ? (
              <DropdownMenuItem onSelect={() => change.execute([prospectId], "new")}><Undo2 /> Lift do not contact</DropdownMenuItem>
            ) : <p className="px-2 py-1.5 text-sm text-muted-foreground">Only administrators can lift do-not-contact.</p>
          ) : (
            <>
              <DropdownMenuLabel>Change status</DropdownMenuLabel>
              {options.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Approve a message, then use “Mark contacted”.</p>}
              {options.map((s) => (
                <DropdownMenuItem key={s} onSelect={() => (RESPONSE_STATUSES.includes(s) ? setPendingStatus(s) : change.execute([prospectId], s))}>
                  {OUTREACH_STATUS_LABELS[s]}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setDncOpen(true)}><Ban /> Do not contact</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={pendingStatus !== null} onOpenChange={(o) => !o && setPendingStatus(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record: {pendingStatus ? OUTREACH_STATUS_LABELS[pendingStatus] : ""}</DialogTitle>
            <DialogDescription>Manually recorded outcomes are labelled as manual in reports.</DialogDescription>
          </DialogHeader>
          <Textarea aria-label="Note" placeholder="What did they say? (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingStatus(null)}>Cancel</Button>
            <Button variant="primary" loading={change.pending} onClick={() => pendingStatus && change.execute([prospectId], pendingStatus, note || undefined)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dncOpen} onOpenChange={setDncOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark do not contact?</DialogTitle>
            <DialogDescription>Removes the business from outreach and suppresses it in future discovery. Only administrators can lift this.</DialogDescription>
          </DialogHeader>
          <Input aria-label="Reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Apply to all projects</span>
            <Switch checked={global} onCheckedChange={setGlobal} />
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDncOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={dnc.pending} onClick={() => dnc.execute([prospectId], reason, global)}>Mark do not contact</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
