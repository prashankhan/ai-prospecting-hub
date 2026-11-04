import { BadgeCheck, CircleHelp, CircleSlash, Split, SearchX } from "lucide-react";
import { Badge, Dot } from "@/components/ui/badge";
import { OUTREACH_STATUS_LABELS, type OutreachStatus } from "@/lib/domain/outreach";
import { cn } from "@/lib/utils";

const OUTREACH_TONE: Record<OutreachStatus, "neutral" | "accent" | "success" | "warning" | "danger" | "info"> = {
  new: "neutral",
  draft: "neutral",
  ready_for_review: "warning",
  approved: "accent",
  contacted: "info",
  responded: "info",
  interested: "success",
  not_interested: "neutral",
  trial_registered: "success",
  converted: "success",
  do_not_contact: "danger",
};

export function OutreachStatusBadge({ status }: { status: OutreachStatus }) {
  return (
    <Badge tone={OUTREACH_TONE[status]}>
      <Dot />
      {OUTREACH_STATUS_LABELS[status]}
    </Badge>
  );
}

const QUAL: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  pending: { label: "Not assessed", tone: "neutral" },
  qualified: { label: "Qualified", tone: "success" },
  needs_review: { label: "Needs review", tone: "warning" },
  disqualified: { label: "Disqualified", tone: "danger" },
};

export function QualificationBadge({ status }: { status: string }) {
  const q = QUAL[status] ?? QUAL.pending;
  return <Badge tone={q.tone}>{q.label}</Badge>;
}

export function ScorePill({ score, className }: { score: number | null; className?: string }) {
  if (score === null || score === undefined) return <span className={cn("text-subtle-foreground", className)}>—</span>;
  const tone = score >= 70 ? "text-success" : score >= 45 ? "text-warning" : "text-danger";
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium tabular-nums", className)} title="AI estimate of fit (0–100), not a probability of purchase">
      <span className="relative h-1.5 w-8 overflow-hidden rounded-full bg-surface-muted">
        <span className={cn("absolute inset-y-0 left-0 rounded-full bg-current", tone)} style={{ width: `${score}%` }} />
      </span>
      <span className={tone}>{score}</span>
    </span>
  );
}

export const INSTAGRAM_LABELS: Record<string, string> = {
  verified: "Verified",
  likely: "Likely match — review",
  not_found: "Not found",
  conflicting: "Conflicting matches",
  unknown: "Not checked",
};

export function InstagramStatusBadge({ status }: { status: string }) {
  const map = {
    verified: { tone: "success" as const, Icon: BadgeCheck },
    likely: { tone: "warning" as const, Icon: CircleHelp },
    not_found: { tone: "neutral" as const, Icon: SearchX },
    conflicting: { tone: "danger" as const, Icon: Split },
    unknown: { tone: "outline" as const, Icon: CircleSlash },
  }[status] ?? { tone: "outline" as const, Icon: CircleSlash };
  return (
    <Badge tone={map.tone}>
      <map.Icon />
      {INSTAGRAM_LABELS[status] ?? status}
    </Badge>
  );
}
