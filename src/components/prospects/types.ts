import type { Tables } from "@/lib/supabase/database.types";

export type ProspectFull = Tables<"project_prospects">;
export type Draft = Pick<Tables<"message_drafts">, "id" | "version" | "body" | "status" | "origin" | "provider" | "model" | "metadata" | "created_at" | "approved_at" | "created_by">;
export type Qualification = Pick<Tables<"qualification_results">, "id" | "score" | "recommended_status" | "explanation" | "evidence" | "source_refs" | "missing_information" | "researched_at" | "provider" | "model" | "created_at">;
export type Activity = Pick<Tables<"outreach_activities">, "id" | "type" | "from_status" | "to_status" | "is_manual" | "details" | "created_at" | "actor_id">;
export type Note = Pick<Tables<"prospect_notes">, "id" | "body" | "created_at" | "author_id">;

export interface EvidenceItem { claim: string; source_ref: string }
export interface SourceRef { ref: string; kind: string; label: string; url: string | null }
