"use client";
import { useState } from "react";
import { Copy, MoreHorizontal, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/app/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { formatDate } from "@/lib/utils";
import { inviteUser, setUserProjects, updateUserAccess } from "@/server/actions/team";

interface Member { id: string; email: string; full_name: string | null; app_role: "admin" | "operator"; status: "active" | "disabled"; created_at: string; projects: string[] }
interface Project { id: string; name: string }

function ProjectPicker({ projects, value, onChange }: { projects: Project[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-md border border-border p-2">
      {projects.length === 0 && <p className="text-sm text-muted-foreground">No projects yet.</p>}
      {projects.map((p) => (
        <label key={p.id} className="flex items-center gap-2 text-sm">
          <Checkbox checked={value.includes(p.id)} onCheckedChange={(c) => onChange(c ? [...value, p.id] : value.filter((x) => x !== p.id))} />
          {p.name}
        </label>
      ))}
    </div>
  );
}

export function InviteDialog({ projects }: { projects: Project[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", full_name: "", role: "operator" as "admin" | "operator", project_ids: [] as string[], delivery: "link" as "email" | "link" });
  const [link, setLink] = useState<string | null>(null);
  const { execute, pending } = useAction(inviteUser, { onSuccess: (d) => setLink(d.link) });
  const reset = () => { setForm({ email: "", full_name: "", role: "operator", project_ids: [], delivery: "link" }); setLink(null); };
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild><Button variant="primary"><UserPlus /> Invite member</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>Public sign-up is disabled. Members join only through an invitation.</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">Share this one-time link with <strong>{form.email}</strong>. It lets them set a password and sign in.</p>
            <div className="flex gap-2">
              <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button onClick={async () => { try { await navigator.clipboard.writeText(link); toast.success("Link copied."); } catch { toast.error("Copy failed — select the link and copy it manually."); } }}><Copy /> Copy</Button>
            </div>
            <DialogFooter><Button onClick={() => setOpen(false)}>Done</Button></DialogFooter>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); execute(form); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" htmlFor="inv-email"><Input id="inv-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Full name" htmlFor="inv-name" optional><Input id="inv-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
              <Field label="Role" htmlFor="inv-role">
                <NativeSelect id="inv-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "operator" })}>
                  <option value="operator">Operator</option>
                  <option value="admin">Administrator</option>
                </NativeSelect>
              </Field>
              <Field label="Delivery" htmlFor="inv-delivery" hint={form.delivery === "email" ? "Requires email delivery configured in Supabase Auth." : "You copy and share the link yourself."}>
                <NativeSelect id="inv-delivery" value={form.delivery} onChange={(e) => setForm({ ...form, delivery: e.target.value as "email" | "link" })}>
                  <option value="link">Create invitation link</option>
                  <option value="email">Send invitation email</option>
                </NativeSelect>
              </Field>
            </div>
            {form.role === "operator" && (
              <Field label="Projects" hint="Operators can only access the projects selected here.">
                <ProjectPicker projects={projects} value={form.project_ids} onChange={(v) => setForm({ ...form, project_ids: v })} />
              </Field>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={pending}>Create invitation</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProjectsDialog({ member, projects, open, onOpenChange }: { member: Member; projects: Project[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [value, setValue] = useState(member.projects);
  const { execute, pending } = useAction(setUserProjects.bind(null, member.id), { onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Project access</DialogTitle>
          <DialogDescription>{member.full_name ?? member.email}</DialogDescription>
        </DialogHeader>
        <ProjectPicker projects={projects} value={value} onChange={setValue} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => execute(value)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({ m, projects, currentUserId }: { m: Member; projects: Project[]; currentUserId: string }) {
  const [projectsOpen, setProjectsOpen] = useState(false);
  const { execute, pending } = useAction(updateUserAccess.bind(null, m.id));
  const names = m.projects.map((id) => projects.find((p) => p.id === id)?.name).filter(Boolean);
  return (
    <TR>
      <TD>
        <p className="font-medium">{m.full_name ?? "—"} {m.id === currentUserId && <span className="text-xs font-normal text-muted-foreground">(you)</span>}</p>
        <p className="text-xs text-muted-foreground">{m.email}</p>
      </TD>
      <TD>{m.app_role === "admin" ? <Badge tone="accent">Administrator</Badge> : <Badge>Operator</Badge>}</TD>
      <TD className="max-w-64 truncate text-muted-foreground">{m.app_role === "admin" ? "All projects" : names.join(", ") || "None"}</TD>
      <TD>{m.status === "active" ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Disabled</Badge>}</TD>
      <TD className="text-muted-foreground">{formatDate(m.created_at)}</TD>
      <TD className="w-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Member actions" loading={pending}>{!pending && <MoreHorizontal />}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {m.app_role === "operator" && <DropdownMenuItem onSelect={() => setProjectsOpen(true)}>Edit project access</DropdownMenuItem>}
            {m.app_role === "operator"
              ? <DropdownMenuItem onSelect={() => execute({ role: "admin" })}>Make administrator</DropdownMenuItem>
              : <DropdownMenuItem onSelect={() => execute({ role: "operator" })}>Change to operator</DropdownMenuItem>}
            <DropdownMenuSeparator />
            {m.status === "active"
              ? <DropdownMenuItem destructive disabled={m.id === currentUserId} onSelect={() => execute({ status: "disabled" })}>Disable access</DropdownMenuItem>
              : <DropdownMenuItem onSelect={() => execute({ status: "active" })}>Restore access</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        {projectsOpen && <ProjectsDialog member={m} projects={projects} open={projectsOpen} onOpenChange={setProjectsOpen} />}
      </TD>
    </TR>
  );
}

export function TeamTable({ members, projects, currentUserId }: { members: Member[]; projects: Project[]; currentUserId: string }) {
  return (
    <Table>
      <THead><TR><TH>Member</TH><TH>Role</TH><TH>Projects</TH><TH>Status</TH><TH>Joined</TH><TH /></TR></THead>
      <TBody>{members.map((m) => <MemberRow key={m.id} m={m} projects={projects} currentUserId={currentUserId} />)}</TBody>
    </Table>
  );
}
