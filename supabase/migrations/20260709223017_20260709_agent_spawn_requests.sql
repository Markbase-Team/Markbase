-- Worker auto-spawn: creating an agent can ask the local worker to launch a
-- Claude Code session (seeded with "Hi, your name is <name>") that binds to the
-- named agent slot. This is the queue the worker drains on its idle poll; the
-- ticket-dispatch `jobs` table is deliberately left untouched.
create table if not exists public.agent_spawn_requests (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null,
  agent_session_id uuid not null references public.agent_sessions(id) on delete cascade,
  project          text not null,
  prompt           text not null,
  status           text not null default 'queued'
                     check (status in ('queued', 'running', 'done', 'error')),
  error            text,
  created_at       timestamptz not null default now(),
  claimed_at       timestamptz,
  finished_at      timestamptz
);

create index if not exists agent_spawn_requests_owner_status_idx
  on public.agent_spawn_requests (owner_id, status, created_at);
