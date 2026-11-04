"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { DEFAULT_DUPLICATE_POLICY, type DuplicatePolicy } from "@/lib/domain/policy";
import { POLICY_FIELDS } from "@/lib/domain/policy-labels";
import { updateDuplicatePolicy } from "@/server/actions/settings";

export function DuplicatePolicyForm({ policy }: { policy: DuplicatePolicy }) {
  const [v, setV] = useState(policy);
  const { execute, pending } = useAction(updateDuplicatePolicy);
  return (
    <Card>
      <CardHeader className="flex-col gap-0.5">
        <CardTitle>Workspace policy</CardTitle>
        <CardDescription>Applied by the database during every import and discovery job. Projects can override individual settings.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border p-0">
        {POLICY_FIELDS.map((f) => (
          <div key={f.key} className="flex items-start justify-between gap-4 px-4 py-3">
            <label htmlFor={f.key} className="min-w-0">
              <span className="block text-sm font-medium">{f.label}</span>
              <span className="block text-xs text-muted-foreground">{f.description}</span>
            </label>
            <Switch id={f.key} checked={v[f.key]} onCheckedChange={(c) => setV((s) => ({ ...s, [f.key]: c }))} />
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <label htmlFor="refresh_interval_days">
            <span className="block text-sm font-medium">Refresh interval</span>
            <span className="block text-xs text-muted-foreground">Days before research is considered stale and may be refreshed.</span>
          </label>
          <Input id="refresh_interval_days" type="number" min={1} max={730} className="w-24" value={v.refresh_interval_days} onChange={(e) => setV((s) => ({ ...s, refresh_interval_days: Number(e.target.value) }))} />
        </div>
      </CardContent>
      <CardFooter className="justify-between">
        <Button variant="ghost" size="sm" onClick={() => setV(DEFAULT_DUPLICATE_POLICY)}>Reset to recommended defaults</Button>
        <Button variant="primary" size="sm" loading={pending} onClick={() => execute(v)}>Save policy</Button>
      </CardFooter>
    </Card>
  );
}
