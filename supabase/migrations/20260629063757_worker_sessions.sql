-- Pick a Claude session when creating a ticket: let a ticket resume an existing
-- Claude Code session (claude -r) instead of starting fresh.
--
-- The worker reports the recent sessions per repo it finds in ~/.claude/projects
-- (same sweep as worker_repos) into worker_sessions; the admin ticket modal
-- reads them to offer a "continue a session" picker. The chosen id is stored on
-- the ticket; at dispatch the worker resumes it if it still exists on disk, else
-- falls back to a fresh session (sessions get pruned, ~30 days).

alter table public.tickets
  add column if not exists cc_seed_session_id text;

create table if not exists public.worker_sessions (
  owner_id    uuid not null references auth.users (id) on delete cascade,
  session_id  text not null,            -- Claude session UUID (the .jsonl name)
  repo_cwd    text not null,            -- the repo's git toplevel (matches worker_repos.cwd / projects.local_path)
  title       text,                     -- first user message, truncated
  last_active timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (owner_id, session_id)
);

alter table public.worker_sessions enable row level security;

drop policy if exists "public all worker_sessions" on public.worker_sessions;
create policy "public all worker_sessions"
  on public.worker_sessions for all
  using (true) with check (true);

-- Replace the owner's reported sessions atomically (one round-trip per sweep).
create or replace function public.report_worker_sessions(
  p_owner_id  uuid,
  p_sessions  jsonb
)
  returns void
  language plpgsql
as $$
begin
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
