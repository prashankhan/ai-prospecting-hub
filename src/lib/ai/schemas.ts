import { z } from "zod";

/** Structured output contracts for the agent. Model output is untrusted until validated here. */

export const qualificationOutputSchema = z.object({
  score: z.number().int().min(0).max(100),
  recommended_status: z.enum(["qualified", "needs_review", "disqualified"]),
  explanation: z.string().trim().min(10).max(2000),
  evidence: z
    .array(z.object({ claim: z.string().trim().min(3).max(400), source_ref: z.string().trim().min(1).max(20) }))
    .max(12),
  missing_information: z.array(z.string().trim().min(2).max(200)).max(12),
});
export type QualificationOutput = z.infer<typeof qualificationOutputSchema>;

export const messageOutputSchema = z.object({
  message: z.string().trim().min(10).max(1500),
  personalization: z
    .array(z.object({ detail: z.string().trim().min(2).max(300), source_ref: z.string().trim().min(1).max(20) }))
    .max(6),
});
export type MessageOutput = z.infer<typeof messageOutputSchema>;

export interface SourceDoc {
  ref: string; // e.g. "S1"
  kind: "source_record" | "website" | "user_note";
  label: string;
  url?: string;
  content: string;
}

/**
 * Enforces provenance: every evidence item must cite a source that was actually provided.
 * Items citing unknown sources are removed and reported, never silently kept.
 */
export function enforceProvenance<T extends { source_ref: string }>(
  items: T[],
  sources: SourceDoc[],
): { kept: T[]; rejected: T[] } {
  const refs = new Set(sources.map((s) => s.ref.toUpperCase()));
  const kept: T[] = [];
  const rejected: T[] = [];
  for (const item of items) {
    (refs.has(item.source_ref.toUpperCase()) ? kept : rejected).push(item);
  }
  return { kept, rejected };
}

/**
 * Final qualification status. The model recommends; the project threshold caps it:
 * a "qualified" recommendation below threshold, or one without any valid evidence,
 * becomes "needs_review".
 */
export function decideQualificationStatus(
  output: Pick<QualificationOutput, "score" | "recommended_status">,
  threshold: number,
  validEvidenceCount: number,
): "qualified" | "needs_review" | "disqualified" {
  if (output.recommended_status === "disqualified") return "disqualified";
  if (output.recommended_status === "qualified" && output.score >= threshold && validEvidenceCount > 0) {
    return "qualified";
  }
  return "needs_review";
}
