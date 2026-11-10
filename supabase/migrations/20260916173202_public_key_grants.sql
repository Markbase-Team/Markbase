-- Grant the public key exactly what the CLI worker, desktop app and browser
-- still need -- explicitly, instead of inheriting it.
--
-- Production reached its current state by accident: Supabase's default
-- privileges granted anon everything in public and docs, so every table was
-- open until 20260916162448_security_lockdown_stage1 revoked the parts nothing
-- used. A database built fresh from this repo has no such inheritance, so the
-- worker would get nothing at all and a self-hosted install would not run.
--
-- This states the remainder as a decision. On production it changes nothing
-- (these grants already exist); on a new database it reproduces the same end
-- state, so both pass supabase/tests/security_lockdown.test.sql.
--
-- Stage 2 removes most of this: once the CLI and desktop app hold a per-user
-- session, these tables move to owner-scoped policies and the public key keeps
-- only sign-in. Until then, app-layer ownership checks are all that separate
-- one user's rows from another's here.

grant usage on schema docs to anon, authenticated;

-- Polled and updated by the worker: claim jobs, report progress, answer agent
-- requests, refresh the stored Claude version. Never insert or delete.
grant select, update on table
  public.api_keys,
  public.jobs,
  public.tickets,
  public.agent_sessions,
  public.agent_spawn_requests,
  public.agent_message_requests
to anon, authenticated;

-- Read-only: the worker checks the plan and resolves a ticket's project.
grant select on table
  public.user_plans,
  public.projects
to anon, authenticated;

-- The worker posts its replies as ticket messages.
grant select, insert on table public.ticket_messages to anon, authenticated;

-- Worker presence and repo discovery, written through the RPCs below.
grant select, insert, update on table
  public.workers,
  public.worker_repos,
  public.worker_sessions
to anon, authenticated;

-- Collaborative editing: the browser, desktop app and vault sync all upsert
-- CRDT snapshots here. No delete -- a snapshot goes when its document does.
grant select, insert, update on table docs.doc_crdt to anon, authenticated;

-- Secrets are the one table the web app reads with the signed-in user's own
-- session rather than the secret key (apps/web/src/lib/secrets.ts), so the
-- authenticated role needs table access -- and only that role; anon gets
-- nothing. The "secrets owner only" policy from stage 1 then limits each user
-- to their own rows. Without this the secrets page fails with "permission
-- denied" on a fresh install, which is how the tests found it.
grant select, insert, update, delete on table public.secrets to authenticated;

-- The worker's RPCs. These run as the caller, so the grants above are what
-- actually lets them work; execute alone is not enough.
grant execute on function
  public.claim_next_job(uuid, text),
  public.reclaim_stale(),
  public.report_worker_repos(uuid, jsonb),
  public.report_worker_sessions(uuid, jsonb),
  public.take_repo_rescan(uuid),
  public.request_repo_rescan(uuid)
to anon, authenticated;
