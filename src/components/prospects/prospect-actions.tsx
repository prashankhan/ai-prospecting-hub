"use client";
import { useState } from "react";
import { MoreHorizontal, PenLine, RefreshCw, UserRoundCheck } from "lucide-react";
import { Field } from "@/components/app/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { assignProspects, refreshProspect, updateProspectDetails } from "@/server/actions/prospects";
import type { ProspectFull } from "./types";

const FIELDS = [
  ["business_name", "Business name"], ["category", "Category"], ["city", "City"], ["country", "Country"],
  ["address", "Address"], ["website", "Website"], ["phone", "Public phone"], ["email", "Public business email"],
] as const;

export function ProspectActions({ prospect, members, isAdmin }: { prospect: ProspectFull; members: { id: string; name: string }[]; isAdmin: boolean }) {
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(() => Object.fromEntries(FIELDS.map(([k]) => [k, prospect[k] ?? ""])) as Record<(typeof FIELDS)[number][0], string>);
  const edit = useAction(updateProspectDetails, { onSuccess: () => setEditOpen(false) });
  const assign = useAction(assignProspects, { success: "Assignment updated." });
  const refresh = useAction(refreshProspect);
  const nul = (v: string) => (v.trim() ? v.trim() : null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="secondary" aria-label="More actions" loading={assign.pending || refresh.pending}>
            {!(assign.pending || refresh.pending) && <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}><PenLine /> Edit details</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => refresh.execute(prospect.id)}><RefreshCw /> Refresh research &amp; re-qualify</DropdownMenuItem>
          {isAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><UserRoundCheck /> Assign</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuLabel>Assign to</DropdownMenuLabel>
                  {members.map((m) => <DropdownMenuItem key={m.id} onSelect={() => assign.execute([prospect.id], m.id)}>{m.name}</DropdownMenuItem>)}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => assign.execute([prospect.id], null)}>Unassign</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Edit business details</DialogTitle></DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              edit.execute(prospect.id, {
                business_name: form.business_name.trim(), category: nul(form.category), city: nul(form.city), country: nul(form.country),
                address: nul(form.address), website: nul(form.website), phone: nul(form.phone), email: nul(form.email),
              });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.map(([k, label]) => (
                <Field key={k} label={label} htmlFor={`e-${k}`} className={k === "address" || k === "business_name" ? "sm:col-span-2" : undefined}>
                  <Input id={`e-${k}`} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} required={k === "business_name"} type={k === "email" ? "email" : "text"} />
                </Field>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Editing details doesn&apos;t change the identity keys used for duplicate detection.</p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={edit.pending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
