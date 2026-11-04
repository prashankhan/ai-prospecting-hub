-- AI Prospecting Hub — authorization helpers, guard triggers and Row Level Security.

-- ---------------------------------------------------------------------------
-- Authorization helpers (security definer so they can be used inside policies without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and app_role = 'admin' and status = 'active'
  );
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.is_project_member(p_project_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1
    from public.project_members m
    join public.profiles p on p.id = m.user_id
    where m.project_id = p_project_id and m.user_id = auth.uid() and p.status = 'active'
  );
$$;

create or replace function public.shares_project_with(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_members a
    join public.project_members b on a.project_id = b.project_id
    where a.user_id = auth.uid() and b.user_id = p_user_id
  );
$$;

-- True when the current request is an end-user request (not service role / migrations).
create or replace function public.is_end_user_request() returns boolean
language sql stable as $$
  select coalesce(auth.role(), '') in ('authenticated', 'anon');
$$;

-- Effective duplicate policy for a project: workspace defaults overlaid by project overrides.
create or replace function public.effective_duplicate_policy(p_project_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select s.duplicate_policy || coalesce(
    (select p.duplicate_policy_overrides from public.projects p where p.id = p_project_id), '{}'::jsonb)
  from public.app_settings s where s.id;
$$;

-- ---------------------------------------------------------------------------
-- Guard triggers
-- ---------------------------------------------------------------------------

-- Users may edit their own display name, never their role, status or email.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_end_user_request() and not public.is_admin() then
    if new.app_role is distinct from old.app_role
       or new.status is distinct from old.status
       or new.email is distinct from old.email
       or new.id is distinct from old.id then
      raise exception 'Not allowed to change role, status or email' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Prospect integrity: identity/project are immutable, DNC can only be lifted by admins,
-- and repeat outreach is blocked at the database level when the policy says so.
create or replace function public.guard_prospect_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_policy jsonb;
begin
  if new.project_id is distinct from old.project_id or new.identity_id is distinct from old.identity_id then
    raise exception 'Prospect project and identity cannot be changed' using errcode = '42501';
  end if;

  if old.do_not_contact and not new.do_not_contact
     and public.is_end_user_request() and not public.is_admin() then
    raise exception 'Only administrators can lift a do-not-contact flag' using errcode = '42501';
  end if;

  if new.do_not_contact then
    new.outreach_status := 'do_not_contact';
  end if;

  -- Defence in depth for direct API access: assignment is an administrator action.
  if new.assigned_to is distinct from old.assigned_to and public.is_end_user_request() and not public.is_admin() then
    raise exception 'Only administrators can assign prospects' using errcode = '42501';
  end if;

  -- Outreach status rules (mirrors src/lib/domain/outreach.ts).
  if new.outreach_status is distinct from old.outreach_status and public.is_end_user_request() then
    if old.outreach_status in ('contacted', 'responded', 'interested', 'not_interested', 'trial_registered', 'converted')
       and new.outreach_status in ('new', 'draft', 'ready_for_review', 'approved') then
      raise exception 'A contacted prospect cannot return to a pre-contact status' using errcode = 'P0001';
    end if;
    if old.outreach_status in ('new', 'draft', 'ready_for_review', 'approved')
       and new.outreach_status in ('contacted', 'responded', 'interested', 'not_interested', 'trial_registered', 'converted') then
      if new.outreach_status <> 'contacted' or new.last_contacted_at is null or old.outreach_status <> 'approved'
         or not exists (select 1 from public.message_drafts d where d.prospect_id = new.id and d.status = 'approved') then
        raise exception 'Prospects can only be marked contacted from an approved message' using errcode = 'P0001';
      end if;
    end if;
    if old.outreach_status = 'do_not_contact' and not public.is_admin() then
      raise exception 'Only administrators can lift a do-not-contact flag' using errcode = '42501';
    end if;
  end if;

  if new.last_contacted_at is distinct from old.last_contacted_at and new.last_contacted_at is not null then
    if old.do_not_contact or new.do_not_contact then
      raise exception 'Prospect is marked do not contact' using errcode = 'P0001';
    end if;
    v_policy := public.effective_duplicate_policy(new.project_id);
    if old.last_contacted_at is not null and coalesce((v_policy ->> 'block_repeat_outreach')::boolean, true) then
      raise exception 'Repeat outreach is blocked: this prospect was already contacted' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger project_prospects_guard before update on public.project_prospects
  for each row execute function public.guard_prospect_update();

-- Child rows must reference a prospect in the same project.
create or replace function public.prospect_in_project(p_prospect_id uuid, p_project_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_prospects where id = p_prospect_id and project_id = p_project_id);
$$;

-- Outreach activity is append-only.
create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  if public.is_end_user_request() then
    raise exception 'This table is append-only' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger outreach_activities_append_only before update or delete on public.outreach_activities
  for each row execute function public.forbid_mutation();
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.provider_configs enable row level security;
alter table public.business_identities enable row level security;
alter table public.identity_keys enable row level security;
alter table public.jobs enable row level security;
alter table public.job_events enable row level security;
alter table public.project_prospects enable row level security;
alter table public.prospect_notes enable row level security;
alter table public.research_results enable row level security;
alter table public.qualification_results enable row level security;
alter table public.message_drafts enable row level security;
alter table public.outreach_activities enable row level security;
alter table public.suppression_records enable row level security;
alter table public.ambiguous_matches enable row level security;
alter table public.usage_events enable row level security;
alter table public.audit_logs enable row level security;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.shares_project_with(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- app_settings: readable by active users, editable by admins
create policy app_settings_select on public.app_settings for select to authenticated
  using (public.is_active_user());
create policy app_settings_update on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- projects
create policy projects_select on public.projects for select to authenticated
  using (public.is_project_member(id));
create policy projects_insert on public.projects for insert to authenticated
  with check (public.is_admin());
create policy projects_update on public.projects for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy projects_delete on public.projects for delete to authenticated
  using (public.is_admin());

-- project_members
create policy project_members_select on public.project_members for select to authenticated
  using (public.is_project_member(project_id));
create policy project_members_write on public.project_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- provider_configs, business_identities, identity_keys: no client policies (service role only).

-- jobs
create policy jobs_select on public.jobs for select to authenticated
  using (public.is_project_member(project_id));
-- Jobs can trigger paid provider usage, so only administrators may create them.
create policy jobs_insert on public.jobs for insert to authenticated
  with check (public.is_admin() and public.is_project_member(project_id) and status = 'queued' and created_by = auth.uid());

create policy job_events_select on public.job_events for select to authenticated
  using (public.is_project_member(project_id));

-- project_prospects: inserts only through ingest_prospect_candidate (service role)
create policy project_prospects_select on public.project_prospects for select to authenticated
  using (public.is_project_member(project_id));
create policy project_prospects_update on public.project_prospects for update to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));
create policy project_prospects_delete on public.project_prospects for delete to authenticated
  using (public.is_admin());

-- prospect child tables
create policy prospect_notes_select on public.prospect_notes for select to authenticated
  using (public.is_project_member(project_id));
create policy prospect_notes_insert on public.prospect_notes for insert to authenticated
  with check (public.is_project_member(project_id) and author_id = auth.uid()
              and public.prospect_in_project(prospect_id, project_id));

create policy research_results_select on public.research_results for select to authenticated
  using (public.is_project_member(project_id));
create policy research_results_insert on public.research_results for insert to authenticated
  with check (public.is_project_member(project_id) and public.prospect_in_project(prospect_id, project_id));

create policy qualification_results_select on public.qualification_results for select to authenticated
  using (public.is_project_member(project_id));
create policy qualification_results_insert on public.qualification_results for insert to authenticated
  with check (public.is_project_member(project_id) and public.prospect_in_project(prospect_id, project_id));

create policy message_drafts_select on public.message_drafts for select to authenticated
  using (public.is_project_member(project_id));
create policy message_drafts_insert on public.message_drafts for insert to authenticated
  with check (public.is_project_member(project_id) and public.prospect_in_project(prospect_id, project_id));
create policy message_drafts_update on public.message_drafts for update to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id) and public.prospect_in_project(prospect_id, project_id));

create policy outreach_activities_select on public.outreach_activities for select to authenticated
  using (public.is_project_member(project_id));
create policy outreach_activities_insert on public.outreach_activities for insert to authenticated
  with check (public.is_project_member(project_id) and actor_id = auth.uid()
              and public.prospect_in_project(prospect_id, project_id));

create policy suppression_records_select on public.suppression_records for select to authenticated
  using (public.is_admin() or (project_id is not null and public.is_project_member(project_id)));

create policy ambiguous_matches_select on public.ambiguous_matches for select to authenticated
  using (public.is_project_member(project_id));

create policy usage_events_select on public.usage_events for select to authenticated
  using (public.is_admin());

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.is_admin());

-- Defence in depth: anonymous users get nothing.
revoke all on all tables in schema public from anon;
