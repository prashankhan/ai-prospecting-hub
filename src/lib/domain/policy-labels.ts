import type { DuplicatePolicy } from "./policy";

export const POLICY_FIELDS: { key: Exclude<keyof DuplicatePolicy, "refresh_interval_days">; label: string; description: string }[] = [
  { key: "global_identity_detection", label: "Global identity detection", description: "Recognize the same business across all projects using normalized Instagram, domain, phone and place identifiers. Details from other projects are never shown." },
  { key: "allow_cross_project_membership", label: "Project-specific prospect membership", description: "Allow a business already known in another project to be added to this project as its own, independent prospect." },
  { key: "skip_previously_discovered", label: "Skip previously discovered profiles", description: "When a business is already in the project, skip it instead of refreshing its source data." },
  { key: "skip_unnecessary_enrichment", label: "Skip unnecessary enrichment", description: "Reuse website research newer than the refresh interval instead of fetching again." },
  { key: "block_repeat_outreach", label: "Block repeat outreach", description: "Once a prospect is marked contacted, block further first-touch outreach. Enforced by the database." },
  { key: "automatic_reprocessing", label: "Automatic reprocessing", description: "Allow bulk qualification to include prospects that were already assessed. Off by default to avoid repeat AI costs." },
  { key: "manual_refresh_allowed", label: "Manual refresh", description: "Allow team members to manually refresh research and re-qualify a prospect." },
  { key: "ambiguous_requires_review", label: "Ambiguous match review", description: "Send same-name, same-location matches without a shared identifier to review instead of creating a new business. Conflicting identifiers always go to review." },
  { key: "suppress_do_not_contact", label: "Do-not-contact suppression", description: "Skip businesses on the do-not-contact list in discovery and imports." },
];
