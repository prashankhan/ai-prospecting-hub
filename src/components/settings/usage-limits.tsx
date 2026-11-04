"use client";
import { useState } from "react";
import { Field } from "@/components/app/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import type { UsageLimits } from "@/lib/domain/policy";
import { updateUsageLimits } from "@/server/actions/settings";

const META: Record<keyof UsageLimits, { label: string; hint: string; min: number; max: number }> = {
  ai_daily_requests: { label: "AI requests per day", hint: "Workspace-wide cap across all providers (UTC day).", min: 0, max: 100000 },
  ai_batch_size: { label: "Bulk AI batch limit", hint: "Maximum prospects per bulk qualification or generation job.", min: 1, max: 100 },
  max_concurrent_jobs: { label: "Concurrent jobs", hint: "Background jobs that may run at the same time.", min: 1, max: 10 },
  discovery_daily_requests: { label: "Discovery requests per day", hint: "Each page of up to 20 results is one request.", min: 0, max: 10000 },
  discovery_max_results_per_job: { label: "Max results per discovery job", hint: "Upper bound for the result limit on a single search.", min: 1, max: 500 },
  research_fetch_timeout_ms: { label: "Website fetch timeout (ms)", hint: "Per page, during research.", min: 1000, max: 20000 },
};

export function UsageLimitsCard({ limits, fields, usedToday, title, description }: { limits: UsageLimits; fields: (keyof UsageLimits)[]; usedToday: { label: string; used: number; cap: number }; title: string; description: string }) {
  const [v, setV] = useState(limits);
  const { execute, pending } = useAction(updateUsageLimits);
  const pct = usedToday.cap ? Math.min(100, Math.round((usedToday.used / usedToday.cap) * 100)) : 100;
  return (
    <Card>
      <CardHeader className="flex-col gap-0.5">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">{usedToday.label}</span><span className="tabular-nums">{usedToday.used} / {usedToday.cap}</span></div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className={pct >= 90 ? "h-full bg-danger" : "h-full bg-accent"} style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {fields.map((f) => (
            <Field key={f} label={META[f].label} htmlFor={f} hint={META[f].hint}>
              <Input id={f} type="number" min={META[f].min} max={META[f].max} value={v[f]} onChange={(e) => setV((s) => ({ ...s, [f]: Number(e.target.value) }))} />
            </Field>
          ))}
        </div>
      </CardContent>
      <CardFooter><Button variant="primary" size="sm" loading={pending} onClick={() => execute(v)}>Save limits</Button></CardFooter>
    </Card>
  );
}
