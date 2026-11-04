"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useAction } from "@/hooks/use-action";
import { setProjectMembers } from "@/server/actions/projects";

export function ProjectMembers({ projectId, users, memberIds }: { projectId: string; users: { id: string; email: string; full_name: string | null; app_role: string; status: string }[]; memberIds: string[] }) {
  const [selected, setSelected] = useState(new Set(memberIds));
  const { execute, pending } = useAction(setProjectMembers.bind(null, projectId));
  const dirty = selected.size !== memberIds.length || memberIds.some((id) => !selected.has(id));
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-border rounded-md border border-border">
        {users.map((u) => (
          <li key={u.id} className="flex items-center gap-3 px-3 py-2">
            <Checkbox
              id={`m-${u.id}`}
              checked={u.app_role === "admin" || selected.has(u.id)}
              disabled={u.app_role === "admin"}
              onCheckedChange={(c) => setSelected((s) => { const n = new Set(s); if (c) n.add(u.id); else n.delete(u.id); return n; })}
            />
            <label htmlFor={`m-${u.id}`} className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{u.full_name ?? u.email}</span>
              <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
            </label>
            {u.app_role === "admin" ? <Badge tone="accent">Admin · all projects</Badge> : <Badge>Operator</Badge>}
            {u.status === "disabled" && <Badge tone="danger">Disabled</Badge>}
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button variant="primary" disabled={!dirty} loading={pending} onClick={() => execute([...selected])}>Save members</Button>
      </div>
    </div>
  );
}
