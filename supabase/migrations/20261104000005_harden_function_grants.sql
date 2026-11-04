-- Hardening from the Supabase security advisor.

-- Pin search_path on the remaining functions.
alter function public.set_updated_at() set search_path = public;
alter function public.is_end_user_request() set search_path = public;
alter function public.forbid_mutation() set search_path = public;

-- Trigger functions are never meant to be called over the API (triggers still fire).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.guard_profile_update() from public, anon, authenticated;
revoke execute on function public.guard_prospect_update() from public, anon, authenticated;
revoke execute on function public.effective_duplicate_policy(uuid) from public, anon, authenticated;

-- Authorization helpers are used inside RLS policies, so signed-in users keep EXECUTE;
-- anonymous callers get nothing.
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_active_user() from public, anon;
revoke execute on function public.is_project_member(uuid) from public, anon;
revoke execute on function public.shares_project_with(uuid) from public, anon;
revoke execute on function public.prospect_in_project(uuid, uuid) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_project_member(uuid) to authenticated;
grant execute on function public.shares_project_with(uuid) to authenticated;
grant execute on function public.prospect_in_project(uuid, uuid) to authenticated;
