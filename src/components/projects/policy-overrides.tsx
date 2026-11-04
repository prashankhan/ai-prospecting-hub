"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import type { DuplicatePolicy } from "@/lib/domain/policy";
import { POLICY_FIELDS } from "@/lib/domain/policy-labels";
import { updateProjectPolicyOverrides } from "@/server/actions/projects";

export function PolicyOverrides({ projectId, workspace, overrides }: { projectId: string; workspace: DuplicatePolicy; overrides: Partial<DuplicatePolicy> }) {
  const [value, setValue] = useState<Partial<DuplicatePolicy>>(overrides);
  const { execute, pending } = useAction(updateProjectPolicyOverrides.bind(null, projectId));
  return (
    <div className="flex flex-col gap-3">
      <div className="divide-y divide-border rounded-md border border-border">
        {POLICY_FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">{f.label}</p>
              <p className="text-xs text-muted-foreground">{f.description}</p>
            </div>
            <NativeSelect
              aria-label={f.label}
              className="w-full sm:w-52"
              value={value[f.key] === undefined ? "inherit" : value[f.key] ? "on" : "off"}
              onChange={(e) => {
                const v = e.target.value;
                setValue((s) => {
                  const n = { ...s };
                  if (v === "inherit") delete n[f.key];
                  else n[f.key] = v === "on";
                  return n;
                });
              }}
            >
              <option value="inherit">Workspace default ({workspace[f.key] ? "on" : "off"})</option>
              <option value="on">On for this project</option>
              <option value="off">Off for this project</option>
            </NativeSelect>
          </div>
        ))}
        <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Refresh interval (days)</p>
            <p className="text-xs text-muted-foreground">Leave empty to use the workspace default ({workspace.refresh_interval_days} days).</p>
          </div>
          <Input
            type="number" min={1} max={730} className="w-full sm:w-52"
            value={value.refresh_interval_days ?? ""}
            onChange={(e) => setValue((s) => {
              const n = { ...s };
              if (e.target.value === "") delete n.refresh_interval_days;
              else n.refresh_interval_days = Number(e.target.value);
              return n;
            })}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" loading={pending} onClick={() => execute(value)}>Save project policy</Button>
      </div>
    </div>
  );
}
