import "server-only";
import { z } from "zod";
import type { ServerClient } from "@/lib/supabase/server";

export const metricsSchema = z.object({
  total_prospects: z.number(),
  new_prospects: z.number(),
  qualified: z.number(),
  needs_review: z.number(),
  duplicates_skipped: z.number(),
  already_known: z.number(),
  ambiguous: z.number(),
  messages_generated: z.number(),
  drafts_approved: z.number(),
  contacted: z.number(),
  replies: z.number(),
  interested: z.number(),
  trials: z.number(),
  converted: z.number(),
  status_breakdown: z.record(z.string(), z.number()),
});
export type Metrics = z.infer<typeof metricsSchema>;

export const RANGES = { "7d": 7, "30d": 30, "90d": 90, all: null } as const;
export type RangeKey = keyof typeof RANGES;

export function parseRange(v: string | undefined): RangeKey {
  return v && v in RANGES ? (v as RangeKey) : "30d";
}

export function rangeStart(range: RangeKey): string | undefined {
  const days = RANGES[range];
  return days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined;
}

export async function getMetrics(supabase: ServerClient, projectId: string, range: RangeKey): Promise<Metrics> {
  const { data, error } = await supabase.rpc("project_metrics", { p_project_id: projectId, p_from: rangeStart(range) });
  if (error) throw new Error(error.message);
  return metricsSchema.parse(data);
}
