-- @mention dispatch: when a comment mentions an agent session, queue a message
-- for the local worker, which resumes that Claude session and lets it reply.
--
-- Deliberately a separate table from agent_spawn_requests rather than a `kind`
-- column on it: an already-running worker drains that queue and would claim rows
-- it doesn't understand, erroring them before it's upgraded.
create table if not exists public.agent_message_requests (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null,
  agent_session_id uuid not null references public.agent_sessions(id) on delete cascade,
  doc_id           uuid,
  comment_id       uuid,
  prompt           text not null,
  status           text not null default 'queued'
                     check (status in ('queued', 'running', 'done', 'error')),
  error            text,
  created_at       timestamptz not null default now(),
  claimed_at       timestamptz,
  finished_at      timestamptz
);

create index if not exists agent_message_requests_owner_status_idx
  on public.agent_message_requests (owner_id, status, created_at);

-- A worker-spawned session never recorded where it runs, so nothing could later
-- resume it. Backfill from the worker's discovery table and keep it going
-- forward (see runSpawn).
update public.agent_sessions s
set context = jsonb_set(coalesce(s.context, '{}'::jsonb), '{repo_cwd}', to_jsonb(ws.repo_cwd))
from public.worker_sessions ws
where ws.owner_id = s.owner_id
  and ws.session_id = s.external_session_id
  and (s.context->>'repo_cwd') is null;
