-- Phase 1 of the Agents feature: our own table mapping a friendly agent name to
-- a provider's session id, plus the provider each connection/session came from.
--
-- Providers are stored as text + CHECK, deliberately NOT a Postgres enum: the
-- ticket_owner enum drifting from the code default is exactly what broke ticket
-- creation, and a CHECK is trivial to widen in a later migration.

-- Which agent tool a connection (API key) came from.
alter table public.api_keys
  add column if not exists provider text not null default 'unknown'
    check (provider in ('claude_code', 'claude_desktop', 'codex', 'cursor', 'unknown'));

-- A named, resumable agent session. name + session_token are ours;
-- external_session_id is the provider's own resumable id. status/ended_reason +
-- last_seen let reconcile mark a session gone when its local memory is deleted
-- upstream (we never rebind onto an empty session).
create table if not exists public.agent_sessions (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null,
  name                text not null,
  provider            text not null
                        check (provider in ('claude_code', 'claude_desktop', 'codex', 'cursor', 'unknown')),
  connection_id       uuid references public.api_keys(id) on delete set null,
  session_token       text not null unique,
  external_session_id text,
  status              text not null default 'pending'
                        check (status in ('pending', 'active', 'idle', 'ended', 'missing')),
  ended_reason        text
                        check (ended_reason in ('user_ended', 'deleted_upstream')),
  context             jsonb not null default '{}'::jsonb,
  last_seen           timestamptz,
  last_active         timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists agent_sessions_owner_provider_idx
  on public.agent_sessions (owner_id, provider);

-- A provider session id maps to at most one row per owner.
create unique index if not exists agent_sessions_owner_provider_extid_key
  on public.agent_sessions (owner_id, provider, external_session_id)
  where external_session_id is not null;

-- Backfill the Claude Code sessions the worker already discovered. worker_sessions
-- stays as the worker's raw discovery source; agent_sessions is the canonical,
-- provider-agnostic table. Skip any already imported (same owner+extid).
insert into public.agent_sessions
  (owner_id, name, provider, session_token, external_session_id, status, context, last_active, last_seen)
select
  ws.owner_id,
  coalesce(nullif(ws.title, ''), 'Session ' || left(ws.session_id, 8)),
  'claude_code',
  'sess_' || replace(gen_random_uuid()::text, '-', ''),
  ws.session_id,
  'active',
  jsonb_build_object('repo_cwd', ws.repo_cwd),
  ws.last_active,
  ws.last_active
from public.worker_sessions ws
where not exists (
  select 1 from public.agent_sessions a
  where a.owner_id = ws.owner_id
    and a.provider = 'claude_code'
    and a.external_session_id = ws.session_id
);
