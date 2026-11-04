-- AI Prospecting Hub — atomic identity resolution, job leasing, suppression and reporting.

-- ---------------------------------------------------------------------------
-- ingest_prospect_candidate
--
-- The single entry point for creating project prospects. Runs in one transaction and takes
-- advisory locks on every identity key, so concurrent imports/discovery jobs cannot create
-- duplicates. Unique constraints on identity_keys and (project_id, identity_id) are the final
-- guarantee. Uncertain identities are never merged automatically: they go to ambiguous_matches.
--
-- Candidate keys are normalized application-side (src/lib/identity) and passed in `keys` as
-- [{ "type": "domain", "value": "example.com" }, ...].
--
-- Outcomes: new | known_added | updated | skipped_existing | skipped_other_project |
--           suppressed | ambiguous
-- ---------------------------------------------------------------------------
create or replace function public.ingest_prospect_candidate(
  p_project_id uuid,
  p_candidate jsonb,
  p_job_id uuid default null,
  p_actor uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_policy jsonb := public.effective_duplicate_policy(p_project_id);
  v_keys jsonb := coalesce(p_candidate -> 'keys', '[]'::jsonb);
  v_key record;
  v_norm_name text := nullif(p_candidate ->> 'normalized_name', '');
  v_country text := nullif(p_candidate ->> 'country_code', '');
  v_city text := nullif(p_candidate ->> 'city_normalized', '');
  v_matches uuid[];
  v_identity uuid;
  v_identity_name text;
  v_strong_hit boolean;
  v_conflict boolean;
  v_prospect uuid;
  v_ambiguous uuid;
  v_outcome text;
  v_weak uuid[];
begin
  if p_project_id is null or v_norm_name is null or nullif(p_candidate ->> 'business_name', '') is null then
    raise exception 'Candidate requires project, business_name and normalized_name' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Unknown project' using errcode = '22023';
  end if;

  -- Serialize on every key (sorted to avoid deadlocks) plus the weak name/location key.
  for v_key in
    select k from (
      select (e ->> 'type') || ':' || (e ->> 'value') as k from jsonb_array_elements(v_keys) e
      union
      select 'name:' || v_norm_name || '|' || coalesce(v_country, '') || '|' || coalesce(v_city, '')
    ) s order by k
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_key.k, 0));
  end loop;

  -- Identities sharing any key with the candidate
  select coalesce(array_agg(distinct ik.identity_id), '{}') into v_matches
  from public.identity_keys ik
  join jsonb_array_elements(v_keys) e
    on ik.key_type = (e ->> 'type')::public.identity_key_type and ik.key_value = e ->> 'value';

  if coalesce((v_policy ->> 'global_identity_detection')::boolean, true) = false and cardinality(v_matches) > 0 then
    -- Global detection disabled: only identities already in this project count as known.
    -- Keys are still globally unique, so a cross-project match cannot get a second identity
    -- and is routed to review instead of being silently merged.
    if not exists (select 1 from public.project_prospects pp
                   where pp.project_id = p_project_id and pp.identity_id = any (v_matches)) then
      insert into public.ambiguous_matches (project_id, job_id, candidate, matched_identity_ids, reason)
      values (p_project_id, p_job_id, p_candidate, v_matches, 'known_identity_global_detection_disabled')
      returning id into v_ambiguous;
      v_outcome := 'ambiguous';
    end if;
  end if;

  if v_outcome is null and cardinality(v_matches) > 1 then
    insert into public.ambiguous_matches (project_id, job_id, candidate, matched_identity_ids, reason)
    values (p_project_id, p_job_id, p_candidate, v_matches, 'keys_match_multiple_identities')
    returning id into v_ambiguous;
    v_outcome := 'ambiguous';
  end if;

  if v_outcome is null and cardinality(v_matches) = 1 then
    v_identity := v_matches[1];
    select normalized_name into v_identity_name from public.business_identities where id = v_identity;

    -- Did a strong key (platform account / place id / username) match?
    select exists (
      select 1 from public.identity_keys ik join jsonb_array_elements(v_keys) e
        on ik.key_type = (e ->> 'type')::public.identity_key_type and ik.key_value = e ->> 'value'
      where ik.identity_id = v_identity and ik.key_type in ('instagram_id', 'instagram_username', 'place_id')
    ) into v_strong_hit;

    -- Does the identity hold a different value for a single-valued key the candidate also has?
    select exists (
      select 1 from public.identity_keys ik join jsonb_array_elements(v_keys) e
        on ik.key_type = (e ->> 'type')::public.identity_key_type
      where ik.identity_id = v_identity
        and ik.key_type in ('instagram_id', 'instagram_username', 'place_id')
        and ik.key_value <> e ->> 'value'
    ) into v_conflict;

    if v_conflict or (not v_strong_hit and v_identity_name is distinct from v_norm_name) then
      insert into public.ambiguous_matches (project_id, job_id, candidate, matched_identity_ids, reason)
      values (p_project_id, p_job_id, p_candidate, v_matches,
              case when v_conflict then 'conflicting_identifiers' else 'shared_contact_different_name' end)
      returning id into v_ambiguous;
      v_outcome := 'ambiguous';
    end if;
  end if;

  if v_outcome is null and cardinality(v_matches) = 0 then
    -- No key match: look for weak (same name + location) matches.
    select coalesce(array_agg(id), '{}') into v_weak
    from public.business_identities
    where normalized_name = v_norm_name
      and country_code is not distinct from v_country
      and city_normalized is not distinct from v_city;

    if cardinality(v_weak) > 0 and coalesce((v_policy ->> 'ambiguous_requires_review')::boolean, true) then
      insert into public.ambiguous_matches (project_id, job_id, candidate, matched_identity_ids, reason)
      values (p_project_id, p_job_id, p_candidate, v_weak, 'same_name_and_location')
      returning id into v_ambiguous;
      v_outcome := 'ambiguous';
    else
      insert into public.business_identities (canonical_name, normalized_name, country_code, city_normalized)
      values (p_candidate ->> 'business_name', v_norm_name, v_country, v_city)
      returning id into v_identity;
    end if;
  end if;

  if v_outcome is null then
    -- Attach any new keys to the identity (keys owned by other identities were handled above).
    insert into public.identity_keys (identity_id, key_type, key_value, source)
    select v_identity, (e ->> 'type')::public.identity_key_type, e ->> 'value', p_candidate ->> 'source'
    from jsonb_array_elements(v_keys) e
    on conflict (key_type, key_value) do nothing;

    if coalesce((v_policy ->> 'suppress_do_not_contact')::boolean, true) and exists (
      select 1 from public.suppression_records s
      where s.identity_id = v_identity and (s.project_id is null or s.project_id = p_project_id)
    ) then
      v_outcome := 'suppressed';
    end if;
  end if;

  if v_outcome is null then
    select id into v_prospect from public.project_prospects
    where project_id = p_project_id and identity_id = v_identity;

    if v_prospect is not null then
      if coalesce((v_policy ->> 'skip_previously_discovered')::boolean, true) then
        v_outcome := 'skipped_existing';
      else
        -- Refresh source data without overwriting human-curated fields.
        update public.project_prospects set
          category = coalesce(nullif(p_candidate ->> 'category', ''), category),
          address = coalesce(nullif(p_candidate ->> 'address', ''), address),
          website = coalesce(website, nullif(p_candidate ->> 'website', '')),
          phone = coalesce(phone, nullif(p_candidate ->> 'phone', '')),
          source_data = source_data || jsonb_build_object('refreshed_' || coalesce(p_candidate ->> 'source', 'unknown'),
                                                         coalesce(p_candidate -> 'source_data', '{}'::jsonb))
        where id = v_prospect;
        v_outcome := 'updated';
      end if;
    elsif cardinality(v_matches) = 1 and exists (
      select 1 from public.project_prospects where identity_id = v_identity and project_id <> p_project_id
    ) and coalesce((v_policy ->> 'allow_cross_project_membership')::boolean, true) = false then
      v_outcome := 'skipped_other_project';
    else
      insert into public.project_prospects (
        project_id, identity_id, business_name, category, country, city, address, website, phone, email,
        instagram_username, instagram_url, instagram_match_status, instagram_evidence,
        source, source_ref, source_data, discovery_job_id, created_by
      ) values (
        p_project_id, v_identity, p_candidate ->> 'business_name',
        nullif(p_candidate ->> 'category', ''), nullif(p_candidate ->> 'country', ''),
        nullif(p_candidate ->> 'city', ''), nullif(p_candidate ->> 'address', ''),
        nullif(p_candidate ->> 'website', ''), nullif(p_candidate ->> 'phone', ''),
        nullif(p_candidate ->> 'email', ''), nullif(p_candidate ->> 'instagram_username', ''),
        nullif(p_candidate ->> 'instagram_url', ''),
        coalesce(nullif(p_candidate ->> 'instagram_match_status', ''), 'unknown')::public.instagram_match_status,
        coalesce(p_candidate -> 'instagram_evidence', '[]'::jsonb),
        coalesce(nullif(p_candidate ->> 'source', ''), 'unknown'), nullif(p_candidate ->> 'source_ref', ''),
        coalesce(p_candidate -> 'source_data', '{}'::jsonb), p_job_id, p_actor
      ) returning id into v_prospect;
      v_outcome := case when cardinality(v_matches) = 1 then 'known_added' else 'new' end;
    end if;
  end if;

  if p_job_id is not null then
    update public.jobs set
      processed = processed + 1,
      new_count = new_count + (v_outcome = 'new')::int,
      known_count = known_count + (v_outcome in ('known_added', 'updated', 'skipped_existing', 'skipped_other_project'))::int,
      skipped_count = skipped_count + (v_outcome in ('skipped_existing', 'skipped_other_project', 'suppressed'))::int,
      ambiguous_count = ambiguous_count + (v_outcome = 'ambiguous')::int
    where id = p_job_id;
  end if;

  insert into public.audit_logs (actor_id, project_id, action, entity_type, entity_id, details)
  values (p_actor, p_project_id, 'prospect.ingest', 'project_prospect', v_prospect::text,
          jsonb_build_object('outcome', v_outcome, 'source', p_candidate ->> 'source', 'job_id', p_job_id,
                             'ambiguous_id', v_ambiguous));

  return jsonb_build_object('outcome', v_outcome, 'prospect_id', v_prospect,
                            'identity_id', v_identity, 'ambiguous_id', v_ambiguous);
end $$;

revoke all on function public.ingest_prospect_candidate(uuid, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ingest_prospect_candidate(uuid, jsonb, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- resolve_ambiguous_match — human decision on an uncertain identity
--   'separate'  : create a new identity (conflicting keys stay with their current owner)
--   'existing'  : link the candidate to one of the matched identities
--   'dismiss'   : discard the candidate
-- ---------------------------------------------------------------------------
create or replace function public.resolve_ambiguous_match(
  p_match_id uuid,
  p_resolution text,
  p_identity_id uuid default null,
  p_actor uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_match public.ambiguous_matches;
  v_c jsonb;
  v_identity uuid;
  v_prospect uuid;
begin
  select * into v_match from public.ambiguous_matches where id = p_match_id for update;
  if v_match.id is null then raise exception 'Match not found' using errcode = '22023'; end if;
  if v_match.status <> 'pending' then raise exception 'Match already resolved' using errcode = 'P0001'; end if;
  v_c := v_match.candidate;

  if p_resolution = 'dismiss' then
    update public.ambiguous_matches set status = 'dismissed', resolved_by = p_actor, resolved_at = now() where id = p_match_id;
    return jsonb_build_object('outcome', 'dismissed');
  elsif p_resolution = 'existing' then
    if p_identity_id is null or not (p_identity_id = any (v_match.matched_identity_ids)) then
      raise exception 'Identity must be one of the matched identities' using errcode = '22023';
    end if;
    v_identity := p_identity_id;
  elsif p_resolution = 'separate' then
    insert into public.business_identities (canonical_name, normalized_name, country_code, city_normalized)
    values (v_c ->> 'business_name', v_c ->> 'normalized_name', nullif(v_c ->> 'country_code', ''), nullif(v_c ->> 'city_normalized', ''))
    returning id into v_identity;
  else
    raise exception 'Unknown resolution' using errcode = '22023';
  end if;

  insert into public.identity_keys (identity_id, key_type, key_value, source)
  select v_identity, (e ->> 'type')::public.identity_key_type, e ->> 'value', 'review'
  from jsonb_array_elements(coalesce(v_c -> 'keys', '[]'::jsonb)) e
  on conflict (key_type, key_value) do nothing;

  if exists (select 1 from public.suppression_records s
             where s.identity_id = v_identity and (s.project_id is null or s.project_id = v_match.project_id)) then
    update public.ambiguous_matches set status = 'dismissed', resolved_by = p_actor, resolved_at = now() where id = p_match_id;
    return jsonb_build_object('outcome', 'suppressed', 'identity_id', v_identity);
  end if;

  select id into v_prospect from public.project_prospects where project_id = v_match.project_id and identity_id = v_identity;
  if v_prospect is null then
    insert into public.project_prospects (
      project_id, identity_id, business_name, category, country, city, address, website, phone, email,
      instagram_username, instagram_url, instagram_match_status, instagram_evidence,
      source, source_ref, source_data, discovery_job_id, created_by
    ) values (
      v_match.project_id, v_identity, v_c ->> 'business_name', nullif(v_c ->> 'category', ''),
      nullif(v_c ->> 'country', ''), nullif(v_c ->> 'city', ''), nullif(v_c ->> 'address', ''),
      nullif(v_c ->> 'website', ''), nullif(v_c ->> 'phone', ''), nullif(v_c ->> 'email', ''),
      nullif(v_c ->> 'instagram_username', ''), nullif(v_c ->> 'instagram_url', ''),
      coalesce(nullif(v_c ->> 'instagram_match_status', ''), 'unknown')::public.instagram_match_status,
      coalesce(v_c -> 'instagram_evidence', '[]'::jsonb), coalesce(nullif(v_c ->> 'source', ''), 'unknown'),
      nullif(v_c ->> 'source_ref', ''), coalesce(v_c -> 'source_data', '{}'::jsonb), v_match.job_id, p_actor
    ) returning id into v_prospect;
  end if;

  update public.ambiguous_matches
  set status = case when p_resolution = 'existing' then 'resolved_existing' else 'resolved_new' end::public.ambiguous_status,
      resolved_by = p_actor, resolved_at = now()
  where id = p_match_id;

  insert into public.audit_logs (actor_id, project_id, action, entity_type, entity_id, details)
  values (p_actor, v_match.project_id, 'ambiguous.resolve', 'ambiguous_match', p_match_id::text,
          jsonb_build_object('resolution', p_resolution, 'prospect_id', v_prospect));

  return jsonb_build_object('outcome', p_resolution, 'prospect_id', v_prospect, 'identity_id', v_identity);
end $$;

revoke all on function public.resolve_ambiguous_match(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_ambiguous_match(uuid, text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Do-not-contact suppression (global by default)
-- ---------------------------------------------------------------------------
create or replace function public.set_do_not_contact(
  p_prospect_id uuid,
  p_reason text,
  p_global boolean,
  p_actor uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p public.project_prospects;
begin
  select * into v_p from public.project_prospects where id = p_prospect_id for update;
  if v_p.id is null then raise exception 'Prospect not found' using errcode = '22023'; end if;

  if p_global then
    insert into public.suppression_records (identity_id, project_id, reason, created_by)
    values (v_p.identity_id, null, coalesce(p_reason, ''), p_actor)
    on conflict (identity_id) where project_id is null do nothing;
    -- Apply to every project that already holds this business.
    update public.project_prospects set do_not_contact = true where identity_id = v_p.identity_id;
  else
    insert into public.suppression_records (identity_id, project_id, reason, created_by)
    values (v_p.identity_id, v_p.project_id, coalesce(p_reason, ''), p_actor)
    on conflict (identity_id, project_id) where project_id is not null do nothing;
    update public.project_prospects set do_not_contact = true where id = p_prospect_id;
  end if;

  insert into public.outreach_activities (project_id, prospect_id, actor_id, type, from_status, to_status, details)
  values (v_p.project_id, v_p.id, p_actor, 'status_change', v_p.outreach_status, 'do_not_contact',
          jsonb_build_object('reason', p_reason, 'global', p_global));
end $$;

revoke all on function public.set_do_not_contact(uuid, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.set_do_not_contact(uuid, text, boolean, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Durable job leasing
-- ---------------------------------------------------------------------------
create or replace function public.claim_job(
  p_job_id uuid default null,
  p_lease_seconds integer default 90,
  p_max_concurrent integer default 2
) returns setof public.jobs
language plpgsql security definer set search_path = public as $$
declare
  v_job public.jobs;
  v_active integer;
begin
  -- Serialize claimers so the concurrency limit is exact.
  perform pg_advisory_xact_lock(hashtextextended('claim_job', 0));

  select count(*) into v_active from public.jobs
  where status = 'running' and lease_expires_at > now();
  if v_active >= p_max_concurrent then
    return;
  end if;

  select * into v_job from public.jobs
  where status in ('queued', 'running')
    and (lease_expires_at is null or lease_expires_at < now())
    and (p_job_id is null or id = p_job_id)
  order by created_at
  limit 1
  for update skip locked;

  if v_job.id is null then
    return;
  end if;

  update public.jobs set
    status = 'running',
    lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    started_at = coalesce(started_at, now())
  where id = v_job.id
  returning * into v_job;

  return next v_job;
end $$;

revoke all on function public.claim_job(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_job(uuid, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Reporting (security invoker: RLS limits results to projects the caller can see)
-- ---------------------------------------------------------------------------
create or replace function public.project_metrics(
  p_project_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
) returns jsonb
language sql stable security invoker set search_path = public as $$
  with p as (
    select * from public.project_prospects where project_id = p_project_id
  ),
  a as (
    select * from public.outreach_activities
    where project_id = p_project_id
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to)
  ),
  j as (
    select * from public.jobs where project_id = p_project_id and type = 'discovery'
      and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
  ),
  d as (
    select * from public.message_drafts where project_id = p_project_id
      and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
  )
  select jsonb_build_object(
    'total_prospects', (select count(*) from p),
    'new_prospects', (select count(*) from p where (p_from is null or discovered_at >= p_from) and (p_to is null or discovered_at < p_to)),
    'qualified', (select count(*) from p where qualification_status = 'qualified'),
    'needs_review', (select count(*) from p where qualification_status = 'needs_review'),
    'duplicates_skipped', (select coalesce(sum(skipped_count), 0) from j),
    'already_known', (select coalesce(sum(known_count), 0) from j),
    'ambiguous', (select coalesce(sum(ambiguous_count), 0) from j),
    'messages_generated', (select count(*) from d where origin = 'ai'),
    'drafts_approved', (select count(*) from a where type = 'draft_approved'),
    'contacted', (select count(distinct prospect_id) from a where type = 'contacted'),
    'replies', (select count(distinct prospect_id) from a where type = 'response_recorded'),
    'interested', (select count(distinct prospect_id) from a where to_status = 'interested'),
    'trials', (select count(distinct prospect_id) from a where to_status = 'trial_registered'),
    'converted', (select count(distinct prospect_id) from a where to_status = 'converted'),
    'status_breakdown', (select coalesce(jsonb_object_agg(outreach_status, c), '{}'::jsonb)
                         from (select outreach_status, count(*) c from p group by outreach_status) s)
  );
$$;

grant execute on function public.project_metrics(uuid, timestamptz, timestamptz) to authenticated;
