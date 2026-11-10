-- ROLLBACK for 20260915_security_lockdown_stage1.sql. NOT a migration: it lives
-- in snippets so `supabase db reset` never runs it.
--
-- Run this only if the lockdown breaks something in production that cannot wait
-- for a fix. It restores the wide-open state, including the parts that let
-- anyone with the publishable key read and write these tables, so treat it as a
-- temporary measure and re-apply the lockdown as soon as the breakage is fixed.
--
-- It does not restore the per-table "public all" policies the lockdown dropped;
-- with the grants back, RLS on those tables denies everything, which is a safe
-- failure. If a caller needs one of these tables, grant only what it needs.

grant all on all tables in schema public to anon, authenticated;
grant all on all tables in schema docs to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
grant execute on all functions in schema docs to anon, authenticated;

alter table public.subscribers disable row level security;
alter table docs.app_config disable row level security;
alter table docs.onboarding_seeded disable row level security;

drop policy if exists "secrets owner only" on public.secrets;
create policy "secrets authenticated all" on public.secrets
  for all to authenticated using (true) with check (true);

alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated;
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated;
alter default privileges for role postgres in schema docs
  grant all on tables to anon, authenticated;
alter default privileges for role postgres in schema docs
  grant execute on functions to anon, authenticated;
