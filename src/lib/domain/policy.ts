import { z } from "zod";

export const duplicatePolicySchema = z.object({
  global_identity_detection: z.boolean(),
  allow_cross_project_membership: z.boolean(),
  skip_previously_discovered: z.boolean(),
  skip_unnecessary_enrichment: z.boolean(),
  block_repeat_outreach: z.boolean(),
  automatic_reprocessing: z.boolean(),
  manual_refresh_allowed: z.boolean(),
  refresh_interval_days: z.number().int().min(1).max(730),
  ambiguous_requires_review: z.boolean(),
  suppress_do_not_contact: z.boolean(),
});
export type DuplicatePolicy = z.infer<typeof duplicatePolicySchema>;

export const DEFAULT_DUPLICATE_POLICY: DuplicatePolicy = {
  global_identity_detection: true,
  allow_cross_project_membership: true,
  skip_previously_discovered: true,
  skip_unnecessary_enrichment: true,
  block_repeat_outreach: true,
  automatic_reprocessing: false,
  manual_refresh_allowed: true,
  refresh_interval_days: 90,
  ambiguous_requires_review: true,
  suppress_do_not_contact: true,
};

export const duplicatePolicyOverridesSchema = duplicatePolicySchema.partial();

export function effectivePolicy(workspace: unknown, overrides: unknown): DuplicatePolicy {
  const base = duplicatePolicySchema.partial().safeParse(workspace);
  const over = duplicatePolicyOverridesSchema.safeParse(overrides);
  return {
    ...DEFAULT_DUPLICATE_POLICY,
    ...(base.success ? base.data : {}),
    ...(over.success ? over.data : {}),
  };
}

export const usageLimitsSchema = z.object({
  ai_daily_requests: z.number().int().min(0).max(100000),
  ai_batch_size: z.number().int().min(1).max(100),
  discovery_daily_requests: z.number().int().min(0).max(10000),
  discovery_max_results_per_job: z.number().int().min(1).max(500),
  max_concurrent_jobs: z.number().int().min(1).max(10),
  research_fetch_timeout_ms: z.number().int().min(1000).max(20000),
});
export type UsageLimits = z.infer<typeof usageLimitsSchema>;

export const DEFAULT_USAGE_LIMITS: UsageLimits = {
  ai_daily_requests: 200,
  ai_batch_size: 10,
  discovery_daily_requests: 50,
  discovery_max_results_per_job: 60,
  max_concurrent_jobs: 2,
  research_fetch_timeout_ms: 8000,
};

export function parseUsageLimits(value: unknown): UsageLimits {
  const parsed = usageLimitsSchema.partial().safeParse(value);
  return { ...DEFAULT_USAGE_LIMITS, ...(parsed.success ? parsed.data : {}) };
}

/** Whether research for a prospect is stale enough to be fetched again. */
export function needsResearch(
  lastResearchedAt: string | null,
  policy: Pick<DuplicatePolicy, "skip_unnecessary_enrichment" | "refresh_interval_days">,
  opts: { force?: boolean; now?: Date } = {},
): boolean {
  if (opts.force) return true;
  if (!lastResearchedAt) return true;
  if (!policy.skip_unnecessary_enrichment) return true;
  const ageMs = (opts.now ?? new Date()).getTime() - new Date(lastResearchedAt).getTime();
  return ageMs > policy.refresh_interval_days * 86_400_000;
}
