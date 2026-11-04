import { OUTREACH_STATUS_LABELS, type OutreachStatus } from "@/lib/domain/outreach";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import type { Activity } from "./types";

const LABELS: Record<string, string> = {
  status_change: "Status changed",
  contacted: "Marked contacted (sent manually)",
  response_recorded: "Response recorded",
  assignment: "Assignment changed",
  draft_generated: "AI draft generated",
  draft_edited: "Message edited",
  draft_approved: "Message approved",
  profile_opened: "Instagram profile opened",
  qualified: "AI qualification",
  instagram_verified: "Instagram verified",
  refreshed: "Research refreshed",
  discovered: "Discovered by the agent",
};

export function ActivityList({ items, names }: { items: Activity[]; names: Record<string, string> }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
      {items.map((a) => {
        const d = (a.details ?? {}) as Record<string, unknown>;
        return (
          <li key={a.id} className="relative">
            <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-surface bg-border-strong" />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <span className="font-medium">{LABELS[a.type] ?? a.type}</span>
              {a.from_status && a.to_status && a.from_status !== a.to_status && (
                <span className="text-muted-foreground">{OUTREACH_STATUS_LABELS[a.from_status as OutreachStatus]} → {OUTREACH_STATUS_LABELS[a.to_status as OutreachStatus]}</span>
              )}
              {a.type === "qualified" && typeof d.score === "number" && <span className="text-muted-foreground">score {d.score}</span>}
              <Badge tone={a.is_manual ? "neutral" : "outline"}>{a.is_manual ? "Manual" : "Automatic"}</Badge>
            </div>
            {typeof d.note === "string" && <p className="mt-0.5 text-sm text-muted-foreground">“{d.note}”</p>}
            {typeof d.reason === "string" && d.reason && <p className="mt-0.5 text-sm text-muted-foreground">Reason: {d.reason}</p>}
            <p className="text-xs text-subtle-foreground">{a.actor_id ? names[a.actor_id] ?? "Team member" : "System"} · {formatDateTime(a.created_at)}</p>
          </li>
        );
      })}
    </ol>
  );
}
