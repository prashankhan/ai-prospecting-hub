"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const OPTIONS = [["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["all", "All time"]] as const;

export function RangePicker({ value }: { value: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <div className="inline-flex rounded-md border border-border bg-surface p-0.5 shadow-xs" role="radiogroup" aria-label="Date range">
      {OPTIONS.map(([id, label]) => {
        const n = new URLSearchParams(params.toString());
        n.set("range", id);
        return (
          <Link key={id} role="radio" aria-checked={value === id} href={`${pathname}?${n}`} scroll={false}
            className={cn("rounded-sm px-2.5 py-1 text-sm transition-colors", value === id ? "bg-accent-soft font-medium text-accent-soft-foreground" : "text-muted-foreground hover:text-foreground")}>
            {label}
          </Link>
        );
      })}
    </div>
  );
}
