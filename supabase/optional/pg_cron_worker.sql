-- OPTIONAL: drive the background job worker from Supabase instead of Vercel Cron
-- (e.g. on the Vercel Hobby plan, where cron jobs can run at most once per day).
-- Requires the pg_cron and pg_net extensions (Database → Extensions in the Supabase dashboard).
-- Replace the URL and secret before running. The secret must equal the app's CRON_SECRET.
select cron.schedule(
  'ai-prospecting-hub-jobs',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://YOUR-APP-DOMAIN/api/jobs/tick',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'),
    timeout_milliseconds := 55000
  );
  $$
);
-- To remove: select cron.unschedule('ai-prospecting-hub-jobs');
