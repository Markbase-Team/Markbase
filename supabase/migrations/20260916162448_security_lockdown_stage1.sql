-- Security lockdown, stage 1: close every table the public key never needed.
--
-- The publishable key ships in the browser bundle and the npm CLI, and until now
-- it could select/insert/delete almost every table: "public all" policies with
-- using (true), and Supabase's default privileges granting anon everything in
-- public and docs.
--
-- This stage touches only what no browser, CLI or desktop code reads with that
-- key (mapped from the code and confirmed against a week of request logs). The
-- web server already talks to these tables with the secret key, which bypasses
-- both grants and RLS, so nothing it does changes.
--
-- Left for stage 2, because the CLI worker, desktop app and browser still use
-- the public key on them: jobs, workers, tickets, ticket_messages, projects,
-- api_keys, agent_sessions, agent_spawn_requests, agent_message_requests,
-- user_plans, worker_repos, worker_sessions, docs.doc_crdt, the worker RPCs, the
-- crdt:* broadcast channels, and the ticket-images / reader-pdfs buckets.

-- 1. Tables only the server touches: no grants for the public roles.
revoke all on table
  public.attention_boards,
  public.attention_items,
  public.email_accounts,
  public.learning_diaries,
  public.project_docs,
  public.project_properties,
  public.reader_documents,
  public.reader_highlights,
  public.reader_messages,
  public.reader_selections,
  public.skill_files,
  public.skills,
  public.subscribers,
  public.term_messages,
  public.terms,
  public.today_todos,
  public.vault_secrets,
  public.work_logs,
  docs.app_config,
  docs.assets,
  docs.comments,
  docs.documents,
  docs.folders,
  docs.links,
  docs.members,
  docs.onboarding_seeded,
  docs.projects,
  docs.steps,
  docs.suggestions,
  docs.vaults
from anon, authenticated;

-- 2. RLS on the three server-only tables that never had it. With no policy,
--    RLS denies everything, so a grant restored by mistake still exposes nothing.
alter table public.subscribers enable row level security;
alter table docs.app_config enable row level security;
alter table docs.onboarding_seeded enable row level security;

-- 3. Drop the allow-everything policies on those tables for the same reason.
drop policy if exists "public all learning_diaries" on public.learning_diaries;
drop policy if exists "public all project_docs" on public.project_docs;
drop policy if exists "public all project_properties" on public.project_properties;
drop policy if exists "public all reader_documents" on public.reader_documents;
drop policy if exists "public all reader_highlights" on public.reader_highlights;
drop policy if exists "public all reader_messages" on public.reader_messages;
drop policy if exists "public all reader_selections" on public.reader_selections;
drop policy if exists "public all skill_files" on public.skill_files;
drop policy if exists "public all skills" on public.skills;
drop policy if exists "public all term_messages" on public.term_messages;
drop policy if exists "public all terms" on public.terms;
drop policy if exists "public all today_todos" on public.today_todos;
drop policy if exists "public all vault_secrets" on public.vault_secrets;
drop policy if exists "public all work_logs" on public.work_logs;
drop policy if exists permissive on docs.assets;
drop policy if exists permissive on docs.comments;
drop policy if exists permissive on docs.documents;
drop policy if exists permissive on docs.folders;
drop policy if exists permissive on docs.links;
drop policy if exists permissive on docs.members;
drop policy if exists permissive on docs.projects;
drop policy if exists permissive on docs.steps;
drop policy if exists permissive on docs.suggestions;
drop policy if exists permissive on docs.vaults;

-- 4. secrets: the web app reads these with the signed-in user's session
--    (lib/secrets.ts), always filtered by owner_id. The old policy let any
--    signed-in user read every user's rows; now the database enforces the
--    owner filter too. Anonymous callers get nothing.
revoke all on table public.secrets from anon;
drop policy if exists "secrets authenticated all" on public.secrets;
create policy "secrets owner only" on public.secrets
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- 5. Functions nobody outside the server should call.
revoke execute on function public.sweep_unconfirmed_api_keys() from public, anon, authenticated;
alter function public.sweep_unconfirmed_api_keys() set search_path = public, pg_temp;
revoke execute on function docs.convert_folder_to_vault(uuid, text, jsonb) from public, anon, authenticated;

-- 6. Tables the CLI worker, desktop and browser still read with the public key
--    until stage 2: keep only the operations they actually use (from the code
--    map and a week of logs: select and update, plus inserts into
--    ticket_messages and doc_crdt upserts). This alone stops the worst abuse
--    today: minting API keys, queueing jobs or agent requests for someone
--    else's machine, granting plans, and deleting anything.
revoke insert, delete, truncate on table
  public.api_keys,
  public.jobs,
  public.tickets,
  public.agent_sessions,
  public.agent_spawn_requests,
  public.agent_message_requests
from anon, authenticated;
revoke insert, update, delete, truncate on table
  public.user_plans,
  public.projects
from anon, authenticated;
revoke delete, truncate on table
  public.ticket_messages,
  docs.doc_crdt
from anon, authenticated;

-- 7. Stop new tables and functions from starting out public. Supabase's
--    defaults grant anon everything in these schemas, which is how this
--    happened. From now on a table the browser or CLI needs gets an explicit
--    grant and a real policy in its own migration.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
-- Tables: this works. A table created later carries an explicit permission
-- list that excludes anon and authenticated.
--
-- Functions: this is NOT enough, and no statement here can be. Supabase keeps
-- its own default-privileges entry, owned by supabase_admin, granting EXECUTE
-- on every new function to anon and authenticated; we can only edit the entry
-- owned by postgres, so a new function still lands with PUBLIC able to execute
-- it. That is exactly how sweep_unconfirmed_api_keys became callable by anon
-- without anyone choosing it.
--
-- So the rule for functions is explicit, not default: every migration that
-- creates a function must revoke execute from public, anon and authenticated
-- unless a caller on the public key genuinely needs it. supabase/tests/
-- security_lockdown.test.sql enforces this — it fails on any function outside
-- the allowlist that anon or authenticated can execute.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema docs
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema docs
  revoke execute on functions from public, anon, authenticated;
