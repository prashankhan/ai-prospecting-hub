-- Web-search discovery support: pre-research identity lookups and a memory of rejected
-- candidates, so the agent never researches the same business twice without reason.

-- Candidates examined and rejected (no verified Instagram, not a match, unreachable…) per project.
create table if not exists public.discovery_rejections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  key_type public.identity_key_type not null,
  key_value text not null,
  reason text not null,
  job_id uuid references public.jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, key_type, key_value)
);
create index if not exists discovery_rejections_project_idx on public.discovery_rejections (project_id, created_at desc);
alter table public.discovery_rejections enable row level security;
create policy discovery_rejections_select on public.discovery_rejections for select to authenticated
  using (public.is_project_member(project_id));

-- Answers "do we already know this business?" before any research is spent on it. Reveals only
-- booleans, never another project's data. Service role only.
create or replace function public.lookup_discovery_candidate(p_project_id uuid, p_keys jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_identities uuid[];
  v_policy jsonb := public.effective_duplicate_policy(p_project_id);
  v_interval int := coalesce((v_policy ->> 'refresh_interval_days')::int, 90);
  v_rejection text;
begin
  select coalesce(array_agg(distinct ik.identity_id), '{}') into v_identities
  from public.identity_keys ik
  join jsonb_array_elements(coalesce(p_keys, '[]'::jsonb)) e
    on ik.key_type = (e ->> 'type')::public.identity_key_type and ik.key_value = e ->> 'value';

  select r.reason into v_rejection
  from public.discovery_rejections r
  join jsonb_array_elements(coalesce(p_keys, '[]'::jsonb)) e
    on r.key_type = (e ->> 'type')::public.identity_key_type and r.key_value = e ->> 'value'
  where r.project_id = p_project_id and r.created_at > now() - make_interval(days => v_interval)
  limit 1;

  return jsonb_build_object(
    'known_globally', cardinality(v_identities) > 0,
    'in_project', exists (select 1 from public.project_prospects pp
                          where pp.project_id = p_project_id and pp.identity_id = any (v_identities)),
    'suppressed', exists (select 1 from public.suppression_records s
                          where s.identity_id = any (v_identities) and (s.project_id is null or s.project_id = p_project_id)),
    'recently_rejected', v_rejection
  );
end $$;

revoke all on function public.lookup_discovery_candidate(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lookup_discovery_candidate(uuid, jsonb) to service_role;

create or replace function public.record_discovery_rejection(p_project_id uuid, p_keys jsonb, p_reason text, p_job_id uuid)
returns void
language sql security definer set search_path = public as $$
  insert into public.discovery_rejections (project_id, key_type, key_value, reason, job_id)
  select p_project_id, (e ->> 'type')::public.identity_key_type, e ->> 'value', left(coalesce(p_reason, ''), 300), p_job_id
  from jsonb_array_elements(coalesce(p_keys, '[]'::jsonb)) e
  on conflict (project_id, key_type, key_value)
  do update set reason = excluded.reason, job_id = excluded.job_id, created_at = now();
$$;

revoke all on function public.record_discovery_rejection(uuid, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.record_discovery_rejection(uuid, jsonb, text, uuid) to service_role;

-- Web discovery jobs record their own event outcomes.
alter table public.outreach_activities drop constraint if exists outreach_activities_type_check;
alter table public.outreach_activities add constraint outreach_activities_type_check check (type in (
  'status_change', 'contacted', 'response_recorded', 'assignment', 'draft_generated',
  'draft_edited', 'draft_approved', 'profile_opened', 'qualified', 'instagram_verified', 'refreshed', 'discovered'
));
