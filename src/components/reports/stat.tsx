import { cn, formatNumber } from "@/lib/utils";

export function Stat({ label, value, hint, manual, className }: { label: string; value: number; hint?: string; manual?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5 rounded-lg border border-border bg-surface px-3.5 py-3 shadow-xs", className)}>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {manual && <span className="rounded-sm bg-surface-muted px-1 text-2xs" title="Recorded manually by team members">manual</span>}
      </dt>
      <dd className="text-xl font-semibold tracking-tight tabular-nums">{formatNumber(value)}</dd>
      {hint && <p className="text-xs text-subtle-foreground">{hint}</p>}
    </div>
  );
}
