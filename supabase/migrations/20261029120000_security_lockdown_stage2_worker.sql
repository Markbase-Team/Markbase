-- Security lockdown, stage 2: the ticket worker's tables and RPCs.
--
-- Stage 1 (20260916162448) closed every table the public key never needed and
-- left these open on purpose: the CLI worker and the desktop app read and wrote
-- them over PostgREST with the publishable key, and called RPCs that took the
-- owner id as an ARGUMENT and trusted it. Anyone holding that key -- it ships in
-- the browser bundle and the npm package -- could claim, read or finish any
-- owner's jobs, rewrite any ticket, post into any thread, read every API key
-- row and every agent session, by naming an owner id.
--
-- From here on the web API is the worker's only upstream. Every worker request
-- carries the machine's API key; the server resolves the key to its owner and
-- talks to these tables with the secret key, which bypasses the grants and
-- policies below. The RPCs keep their signatures (p_owner_id) because the API
-- calls them with the key's owner -- but while the switch below is off they
-- refuse any public caller, so the argument can no longer be forged from
-- outside.
--
-- This migration is ADDITIVE and safe to apply before any worker has updated.
-- The old access stays available behind one switch, docs.app_config
-- 'worker_public_access', so the cutover is a single row update once every
-- worker reports a version >= MIN_WORKER_VERSION -- and a single row update
-- back if one was missed. The grants themselves are untouched here: revoking
-- is the follow-up migration's job, once the switch has been off for a release
-- (the lesson of dbd0a36: revoke last, after the writes have been proven).

-- ---------------------------------------------------------------------------
-- 1. The switch.
--
-- Its initial value is decided by what the database already holds. A database
-- with a worker presence row has had workers polling it, some of which may
-- still be on the old path, so it starts 'on'. A database with none -- a fresh
-- install, the test database -- has no such workers and starts locked.
-- ---------------------------------------------------------------------------
insert into docs.app_config (key, value)
select 'worker_public_access',
       case when exists (select 1 from public.workers) then 'on' else 'off' end
on conflict (key) do nothing;

create or replace function public.worker_public_access()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select value = 'on' from docs.app_config where key = 'worker_public_access'),
    false
  );
$$;
-- Evaluated by the policies below as anon / authenticated, so they must be able
-- to call it. It returns one boolean and reads one row nobody else can see.
-- The secret key's role may call it too: the RPC guard below only asks it for a
-- public caller, but a grant is cheaper than relying on that.
revoke execute on function public.worker_public_access() from public;
grant execute on function public.worker_public_access() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Row security on every worker table, gated on the switch.
--
-- Four of these never had RLS at all (agent_sessions, agent_spawn_requests,
-- agent_message_requests, user_plans): their grants were the only thing between
-- the public key and every owner's rows. The rest had `using (true)` policies.
-- All twelve now have one policy for the public roles: everything while the
-- switch is on, nothing once it is off -- a direct read returns no rows, a
-- direct write is refused (42501). The secret key never sees these.
-- ---------------------------------------------------------------------------
alter table public.agent_sessions enable row level security;
alter table public.agent_spawn_requests enable row level security;
alter table public.agent_message_requests enable row level security;
alter table public.user_plans enable row level security;

drop policy if exists "public all api_keys" on public.api_keys;
drop policy if exists "public all jobs" on public.jobs;
drop policy if exists "public all tickets" on public.tickets;
drop policy if exists "public all ticket_messages" on public.ticket_messages;
drop policy if exists "public read projects" on public.projects;
drop policy if exists "public write projects" on public.projects;
drop policy if exists "public all workers" on public.workers;
drop policy if exists "public all worker_repos" on public.worker_repos;
drop policy if exists "public all worker_sessions" on public.worker_sessions;

do $$
declare
  t text;
begin
  foreach t in array array[
    'api_keys', 'jobs', 'tickets', 'ticket_messages', 'projects', 'user_plans',
    'agent_sessions', 'agent_spawn_requests', 'agent_message_requests',
    'workers', 'worker_repos', 'worker_sessions'
  ] loop
    execute format('drop policy if exists %I on public.%I',
      'worker public access until workers update', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated
         using (public.worker_public_access())
         with check (public.worker_public_access())',
      'worker public access until workers update', t);
  end loop;
end $$;

-- The browser is a database client for ONE thing here: the board and the
-- sidebar read the signed-in user's tickets directly and subscribe to Realtime
-- changes on them (packages/features/projects/src/ui/board.tsx, sidebar.tsx).
-- That session is a real identity, so it keeps reading -- its own rows only,
-- where before it could read everyone's. Anonymous callers get nothing.
drop policy if exists "tickets owner reads" on public.tickets;
create policy "tickets owner reads" on public.tickets
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. The RPCs refuse public callers while the switch is off.
--
-- Same bodies as before; one guard at the top (nested rather than one AND:
-- Postgres does not promise to short-circuit, and a role without EXECUTE on
-- the switch function must not fail here). They stay SECURITY INVOKER: the
-- API calls them as the secret key's role and passes the key's owner, and a
-- worker that has not updated calls them as anon with its own owner id until
-- the switch goes off. After that, an anon call is 42501 before it touches a
-- row -- the policies above would refuse the writes anyway, but a read-only
-- path (reclaim_stale, take_repo_rescan) would otherwise just do nothing, and
-- "refused" is the answer the tests and the logs should see.
-- ---------------------------------------------------------------------------
create or replace function public.claim_next_job(p_owner_id uuid, p_version text default null)
returns public.jobs
language plpgsql
as $$
declare
  job public.jobs;
begin
  if current_user in ('anon', 'authenticated') then
    if not public.worker_public_access() then
      raise insufficient_privilege using message = 'claim_next_job is called by the worker API';
    end if;
  end if;

  -- Presence stamp on EVERY poll, including the idle (no-job) path below.
  insert into public.workers (owner_id, last_poll_at, worker_version)
    values (p_owner_id, now(), p_version)
    on conflict (owner_id) do update
      set last_poll_at   = now(),
          worker_version = coalesce(excluded.worker_version, public.workers.worker_version);

  select * into job from public.jobs
    where status = 'queued' and owner_id = p_owner_id
    order by created_at
    for update skip locked
    limit 1;
  if not found then
    return null;
  end if;
  update public.jobs set status = 'running', claimed_at = now()
    where id = job.id
    returning * into job;
  return job;
end;
$$;

create or replace function public.reclaim_stale()
returns void
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if not public.worker_public_access() then
      raise insufficient_privilege using message = 'reclaim_stale is called by the worker API and pg_cron';
    end if;
  end if;

  update public.jobs
    set status = 'error', error = 'timed out', finished_at = now()
    where status = 'running' and claimed_at < now() - interval '5 minutes';

  update public.tickets
    set cc_state = 'error',
        cc_summary = 'Run interrupted — the worker stopped, slept, or restarted. Click Run again to retry.'
    where cc_state = 'running' and cc_last_run < now() - interval '5 minutes';

  update public.tickets t
    set cc_state = 'error',
        cc_summary = 'Queue entry was lost. Click Run again to retry.'
    where t.cc_state = 'queued'
      and t.cc_last_run < now() - interval '10 minutes'
      and not exists (
        select 1 from public.jobs j
        where j.ticket_id = t.id and j.status in ('queued', 'running')
      );
end;
$$;

create or replace function public.report_worker_repos(p_owner_id uuid, p_repos jsonb)
returns void
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if not public.worker_public_access() then
      raise insufficient_privilege using message = 'report_worker_repos is called by the worker API';
    end if;
  end if;

  delete from public.worker_repos where owner_id = p_owner_id;
  insert into public.worker_repos (owner_id, cwd, remote, branch, status, last_active)
  select
    p_owner_id,
    e ->> 'cwd',
    e ->> 'remote',
    e ->> 'branch',
    e ->> 'status',
    (e ->> 'last_active')::timestamptz
  from jsonb_array_elements(coalesce(p_repos, '[]'::jsonb)) e
  where e ->> 'cwd' is not null;
end;
$$;

create or replace function public.report_worker_sessions(p_owner_id uuid, p_sessions jsonb)
returns void
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if not public.worker_public_access() then
      raise insufficient_privilege using message = 'report_worker_sessions is called by the worker API';
    end if;
  end if;

  delete from public.worker_sessions where owner_id = p_owner_id;
  insert into public.worker_sessions (owner_id, session_id, repo_cwd, title, last_active)
  select
    p_owner_id,
    e ->> 'session_id',
    e ->> 'repo_cwd',
    e ->> 'title',
    (e ->> 'last_active')::timestamptz
  from jsonb_array_elements(coalesce(p_sessions, '[]'::jsonb)) e
  where e ->> 'session_id' is not null;
end;
$$;

create or replace function public.request_repo_rescan(p_owner_id uuid)
returns void
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if not public.worker_public_access() then
      raise insufficient_privilege using message = 'request_repo_rescan is called by the web API';
    end if;
  end if;

  insert into public.workers (owner_id, last_poll_at, rescan_requested_at)
    values (p_owner_id, 'epoch', now())
    on conflict (owner_id) do update
      set rescan_requested_at = now();
end;
$$;

create or replace function public.take_repo_rescan(p_owner_id uuid)
returns boolean
language plpgsql
as $$
declare
  requested boolean;
begin
  if current_user in ('anon', 'authenticated') then
    if not public.worker_public_access() then
      raise insufficient_privilege using message = 'take_repo_rescan is called by the worker API';
    end if;
  end if;

  update public.workers
    set rescan_requested_at = null
    where owner_id = p_owner_id and rescan_requested_at is not null
    returning true into requested;
  return coalesce(requested, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The server can do what the worker no longer does.
--
-- A no-op on production, where the secret key's role has had these since the
-- tables were created. Stated here because a database built from this repo
-- does not always have them (a local `db reset` has come up with service_role
-- holding nothing on public.*), and the API is now the ONLY path for these
-- writes -- a server that cannot make them is a worker that silently does
-- nothing, which is exactly the failure stage 1 taught us to test for.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on table
  public.api_keys,
  public.jobs,
  public.tickets,
  public.ticket_messages,
  public.projects,
  public.user_plans,
  public.agent_sessions,
  public.agent_spawn_requests,
  public.agent_message_requests,
  public.workers,
  public.worker_repos,
  public.worker_sessions
to service_role;

grant execute on function
  public.claim_next_job(uuid, text),
  public.reclaim_stale(),
  public.report_worker_repos(uuid, jsonb),
  public.report_worker_sessions(uuid, jsonb),
  public.take_repo_rescan(uuid),
  public.request_repo_rescan(uuid)
to service_role;

-- ---------------------------------------------------------------------------
-- Rollout, in order (also in docs/security-stage2-plan.md):
--
--   1. apply this migration            -- nothing changes for running workers
--   2. deploy the web app              -- the worker endpoints exist
--   3. release the CLI and the desktop app (>= MIN_WORKER_VERSION)
--   4. `select owner_id, worker_version from public.workers` until every row
--      is on the new build, then the cutover:
--        update docs.app_config set value = 'off' where key = 'worker_public_access';
--      rollback, if a worker was missed, is the same row set back to 'on'.
--   5. follow-up migration: revoke the grants on these twelve tables and
--      execute on the six RPCs from anon and authenticated, drop the switch,
--      its function and the policies, and move the tables into section 1 of
--      supabase/tests/security_lockdown.test.sql.
-- ---------------------------------------------------------------------------
