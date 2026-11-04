-- AI Prospecting Hub — core schema (V1)
-- Versioned, repeatable migration. Apply with `supabase db push` or the SQL editor, in filename order.


-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'operator');
create type public.user_status as enum ('active', 'disabled');
create type public.project_status as enum ('active', 'paused', 'archived');
create type public.outreach_channel as enum ('instagram', 'email', 'phone', 'website_form', 'other');
create type public.outreach_status as enum (
  'new', 'draft', 'ready_for_review', 'approved', 'contacted', 'responded',
  'interested', 'not_interested', 'trial_registered', 'converted', 'do_not_contact'
);
create type public.qualification_status as enum ('pending', 'qualified', 'needs_review', 'disqualified');
create type public.instagram_match_status as enum ('unknown', 'verified', 'likely', 'not_found', 'conflicting');
create type public.provider_kind as enum ('ai', 'discovery');
create type public.provider_status as enum ('unconfigured', 'configured', 'verified', 'error');
create type public.job_type as enum ('discovery', 'qualification', 'message_generation');
create type public.job_status as enum ('queued', 'running', 'completed', 'failed', 'cancelled');
create type public.draft_status as enum ('draft', 'ready_for_review', 'approved', 'superseded', 'sent');
create type public.identity_key_type as enum ('instagram_username', 'instagram_id', 'place_id', 'domain', 'phone');
create type public.ambiguous_status as enum ('pending', 'resolved_new', 'resolved_existing', 'dismissed');

-- ---------------------------------------------------------------------------
-- Utility: updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  app_role public.app_role not null default 'operator',
  status public.user_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Every new auth user gets an operator profile. Admin promotion only happens server-side.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Workspace settings (single row) — duplicate policy & usage limits
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id boolean primary key default true check (id),
  duplicate_policy jsonb not null default jsonb_build_object(
    'global_identity_detection', true,
    'allow_cross_project_membership', true,
    'skip_previously_discovered', true,
    'skip_unnecessary_enrichment', true,
    'block_repeat_outreach', true,
    'automatic_reprocessing', false,
    'manual_refresh_allowed', true,
    'refresh_interval_days', 90,
    'ambiguous_requires_review', true,
    'suppress_do_not_contact', true
  ),
  usage_limits jsonb not null default jsonb_build_object(
    'ai_daily_requests', 200,
    'ai_batch_size', 10,
    'discovery_daily_requests', 50,
    'discovery_max_results_per_job', 60,
    'max_concurrent_jobs', 2,
    'research_fetch_timeout_ms', 8000
  ),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.app_settings (id) values (true) on conflict do nothing;
create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Projects & memberships
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  product_name text not null default '',
  product_description text not null default '',
  website text,
  target_industry text not null default '',
  target_countries text[] not null default '{}',
  target_cities text[] not null default '{}',
  ideal_customer_profile text not null default '',
  qualification_criteria text not null default '',
  exclusion_criteria text not null default '',
  preferred_channel public.outreach_channel not null default 'instagram',
  messaging_tone text not null default '',
  ai_instructions text not null default '',
  outreach_objective text not null default '',
  qualification_threshold smallint not null default 60 check (qualification_threshold between 0 and 100),
  duplicate_policy_overrides jsonb not null default '{}'::jsonb,
  status public.project_status not null default 'active',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index projects_name_key on public.projects (lower(name));
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

-- ---------------------------------------------------------------------------
-- Provider configurations (secrets encrypted application-side; never readable by clients)
-- ---------------------------------------------------------------------------
create table public.provider_configs (
  id uuid primary key default gen_random_uuid(),
  kind public.provider_kind not null,
  provider text not null,
  model text,
  encrypted_secret text,
  secret_hint text,
  is_enabled boolean not null default false,
  is_default boolean not null default false,
  status public.provider_status not null default 'unconfigured',
  last_tested_at timestamptz,
  last_error text,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, provider)
);
create unique index provider_configs_one_default on public.provider_configs (kind) where is_default;
create trigger provider_configs_updated_at before update on public.provider_configs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Global business identities (cross-project; never directly readable by clients)
-- ---------------------------------------------------------------------------
create table public.business_identities (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  normalized_name text not null,
  country_code text,
  city_normalized text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index business_identities_name_loc_idx
  on public.business_identities (normalized_name, country_code, city_normalized);
create trigger business_identities_updated_at before update on public.business_identities
  for each row execute function public.set_updated_at();

-- Strong identity keys. The unique constraint is the database-level duplicate guarantee.
create table public.identity_keys (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.business_identities (id) on delete cascade,
  key_type public.identity_key_type not null,
  key_value text not null check (char_length(key_value) between 1 and 512),
  source text,
  created_at timestamptz not null default now(),
  unique (key_type, key_value)
);
create index identity_keys_identity_idx on public.identity_keys (identity_id);

-- ---------------------------------------------------------------------------
-- Jobs (durable, lease-based)
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  type public.job_type not null,
  provider text,
  params jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'queued',
  cursor jsonb not null default '{}'::jsonb,
  total integer not null default 0,
  processed integer not null default 0,
  new_count integer not null default 0,
  known_count integer not null default 0,
  skipped_count integer not null default 0,
  ambiguous_count integer not null default 0,
  failed_count integer not null default 0,
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  lease_expires_at timestamptz,
  lease_token uuid,
  cancel_requested boolean not null default false,
  last_error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index jobs_project_idx on public.jobs (project_id, created_at desc);
create index jobs_runnable_idx on public.jobs (status, created_at) where status in ('queued', 'running');
create trigger jobs_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

create table public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  outcome text not null,
  record_ref text,
  message text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index job_events_job_idx on public.job_events (job_id, id);

-- ---------------------------------------------------------------------------
-- Project prospects
-- ---------------------------------------------------------------------------
create table public.project_prospects (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  identity_id uuid not null references public.business_identities (id) on delete restrict,
  business_name text not null,
  category text,
  country text,
  city text,
  address text,
  website text,
  phone text,
  email text,
  instagram_username text,
  instagram_url text,
  instagram_match_status public.instagram_match_status not null default 'unknown',
  instagram_evidence jsonb not null default '[]'::jsonb,
  source text not null,
  source_ref text,
  source_data jsonb not null default '{}'::jsonb,
  discovery_job_id uuid references public.jobs (id) on delete set null,
  discovered_at timestamptz not null default now(),
  last_researched_at timestamptz,
  qualification_score smallint check (qualification_score between 0 and 100),
  qualification_status public.qualification_status not null default 'pending',
  qualification_summary text,
  assigned_to uuid references public.profiles (id) on delete set null,
  outreach_status public.outreach_status not null default 'new',
  last_contacted_at timestamptz,
  last_response_at timestamptz,
  do_not_contact boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, identity_id)
);
create index project_prospects_project_idx on public.project_prospects (project_id, created_at desc);
create index project_prospects_status_idx on public.project_prospects (project_id, outreach_status);
create index project_prospects_assigned_idx on public.project_prospects (project_id, assigned_to);
create index project_prospects_score_idx on public.project_prospects (project_id, qualification_score desc nulls last);
create index project_prospects_name_search_idx on public.project_prospects using gin (to_tsvector('simple', business_name));
create trigger project_prospects_updated_at before update on public.project_prospects
  for each row execute function public.set_updated_at();

create table public.prospect_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  prospect_id uuid not null references public.project_prospects (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index prospect_notes_prospect_idx on public.prospect_notes (prospect_id, created_at desc);

-- Research results: retrieved, untrusted content and extracted facts (source data, not AI opinion)
create table public.research_results (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  prospect_id uuid not null references public.project_prospects (id) on delete cascade,
  source_url text not null,
  http_status integer,
  title text,
  content_excerpt text,
  extracted jsonb not null default '{}'::jsonb,
  error text,
  fetched_at timestamptz not null default now()
);
create index research_results_prospect_idx on public.research_results (prospect_id, fetched_at desc);

-- AI qualification results (AI assessment, kept separate from source data)
create table public.qualification_results (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  prospect_id uuid not null references public.project_prospects (id) on delete cascade,
  provider text not null,
  model text not null,
  score smallint not null check (score between 0 and 100),
  recommended_status public.qualification_status not null,
  explanation text not null,
  evidence jsonb not null default '[]'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  missing_information jsonb not null default '[]'::jsonb,
  researched_at timestamptz not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index qualification_results_prospect_idx on public.qualification_results (prospect_id, created_at desc);

create table public.message_drafts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  prospect_id uuid not null references public.project_prospects (id) on delete cascade,
  version integer not null,
  body text not null check (char_length(body) between 1 and 4000),
  status public.draft_status not null default 'draft',
  origin text not null check (origin in ('ai', 'manual')),
  provider text,
  model text,
  created_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prospect_id, version)
);
create index message_drafts_prospect_idx on public.message_drafts (prospect_id, version desc);
-- At most one approved draft per prospect at a time.
create unique index message_drafts_one_approved on public.message_drafts (prospect_id) where status = 'approved';
create trigger message_drafts_updated_at before update on public.message_drafts
  for each row execute function public.set_updated_at();

create table public.outreach_activities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  prospect_id uuid not null references public.project_prospects (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  type text not null check (type in (
    'status_change', 'contacted', 'response_recorded', 'assignment', 'draft_generated',
    'draft_edited', 'draft_approved', 'profile_opened', 'qualified', 'instagram_verified', 'refreshed'
  )),
  from_status public.outreach_status,
  to_status public.outreach_status,
  channel public.outreach_channel,
  -- true when a human recorded the outcome (e.g. "replied"); false for system-recorded events
  is_manual boolean not null default true,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index outreach_activities_prospect_idx on public.outreach_activities (prospect_id, created_at desc);
create index outreach_activities_project_idx on public.outreach_activities (project_id, created_at desc, type);

-- Do-not-contact / suppression records keyed by identity (global) or project
create table public.suppression_records (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.business_identities (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  reason text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index suppression_records_global_key on public.suppression_records (identity_id) where project_id is null;
create unique index suppression_records_project_key on public.suppression_records (identity_id, project_id) where project_id is not null;

-- Ambiguous identity matches awaiting human review
create table public.ambiguous_matches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  candidate jsonb not null,
  matched_identity_ids uuid[] not null default '{}',
  reason text not null,
  status public.ambiguous_status not null default 'pending',
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index ambiguous_matches_project_idx on public.ambiguous_matches (project_id, status, created_at desc);

-- Provider usage metering for cost controls
create table public.usage_events (
  id bigint generated always as identity primary key,
  kind public.provider_kind not null,
  provider text not null,
  operation text not null,
  units integer not null default 1,
  project_id uuid references public.projects (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  success boolean not null default true,
  created_at timestamptz not null default now()
);
create index usage_events_kind_time_idx on public.usage_events (kind, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_time_idx on public.audit_logs (created_at desc);
create index audit_logs_project_idx on public.audit_logs (project_id, created_at desc);
