import { Badge } from "@/components/ui/badge";

const MAP: Record<string, { label: string; tone: "neutral" | "info" | "success" | "danger" | "warning" }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "warning" },
};

export function JobStatusBadge({ status }: { status: string }) {
  const s = MAP[status] ?? MAP.queued;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const JOB_TYPE_LABELS: Record<string, string> = {
  discovery: "Discovery",
  qualification: "AI qualification",
  message_generation: "Message generation",
};
