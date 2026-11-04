-- Free background-job scheduling via Supabase pg_cron + pg_net.
--
-- Vercel's Hobby plan only allows daily cron jobs, so the database pings the app's worker
-- endpoint (/api/jobs/tick) once a minute instead — but only when runnable jobs exist, so an
-- idle workspace generates no requests. The app registers its URL and CRON_SECRET through
-- public.register_job_worker() (service role only); the secret is stored in Supabase Vault.
--
-- On databases without pg_cron/pg_net (e.g. local test PostgreSQL) the schedule is skipped and
-- jobs are still advanced by the app itself and the daily Vercel cron.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.job_worker (
  id boolean primary key default true check (id),
  app_url text,
  updated_at timestamptz not null default now()
);
insert into private.job_worker (id) values (true) on conflict do nothing;
revoke all on private.job_worker from public, anon, authenticated;

-- Called by the app (service role) to keep the worker URL and secret in sync.
create or replace function public.register_job_worker(p_app_url text, p_secret text)
returns boolean
language plpgsql security definer set search_path = public, private as $$
declare
  v_existing uuid;
  v_current text;
begin
  if p_app_url !~ '^https://[a-z0-9.-]+(:[0-9]+)?$' or coalesce(length(p_secret), 0) < 16 then
    raise exception 'A public https URL and a secret of at least 16 characters are required' using errcode = '22023';
  end if;
  update private.job_worker set app_url = p_app_url, updated_at = now()
  where id and app_url is distinct from p_app_url;

  if to_regnamespace('vault') is null then
    return false;
  end if;
  execute 'select id, decrypted_secret from vault.decrypted_secrets where name = $1' into v_existing, v_current
    using 'job_worker_cron_secret';
  if v_existing is null then
    execute 'select vault.create_secret($1, $2, $3)' using p_secret, 'job_worker_cron_secret', 'Bearer secret for /api/jobs/tick';
  elsif v_current is distinct from p_secret then
    execute 'select vault.update_secret($1, $2)' using v_existing, p_secret;
  end if;
  return true;
end $$;

revoke all on function public.register_job_worker(text, text) from public, anon, authenticated;
grant execute on function public.register_job_worker(text, text) to service_role;

-- Invoked by pg_cron. Sends one HTTP request only when there is work to do.
create or replace function private.ping_job_worker()
returns void
language plpgsql security definer set search_path = public, private as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.jobs
    where status in ('queued', 'running') and (lease_expires_at is null or lease_expires_at < now())
  ) then
    return;
  end if;
  select app_url into v_url from private.job_worker where id;
  if v_url is null or to_regnamespace('vault') is null or to_regnamespace('net') is null then
    return;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'job_worker_cron_secret';
  if v_secret is null then
    return;
  end if;
  execute 'select net.http_get(url := $1, headers := $2, timeout_milliseconds := 55000)'
    using v_url || '/api/jobs/tick', jsonb_build_object('Authorization', 'Bearer ' || v_secret);
end $$;

revoke all on function private.ping_job_worker() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'ai-prospecting-hub-job-worker';
    perform cron.schedule('ai-prospecting-hub-job-worker', '* * * * *', 'select private.ping_job_worker()');
  else
    raise notice 'pg_cron/pg_net unavailable: database scheduler not installed';
  end if;
end $$;
