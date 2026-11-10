-- Worker repo discovery: the set of local repos an owner's worker has seen.
--
-- The worker scans ~/.claude/projects (Claude Code's per-project session dirs),
-- dedups each session's `cwd` to its git toplevel, classifies it (ready /
-- no-remote / not-a-repo) and reports the live set here every ~90s. The admin UI
-- reads this to offer a real, git-aware picker for a project's local_path
-- instead of a hand-typed string.
--
-- This table is a transient mirror of what's on disk: a re-scan REPLACES the
-- owner's rows, so a path that disappears (session pruned, folder deleted) just
-- drops out. It is NOT the source of truth for projects — once a path is saved
-- to projects.local_path it stands on its own and is unaffected by re-scans.

create table if not exists public.worker_repos (
  owner_id    uuid not null references auth.users (id) on delete cascade,
  cwd         text not null,            -- git toplevel, or the raw folder when non-git
  remote      text,                     -- owner/repo (or origin url) when status = 'ready'
  branch      text,                     -- last-active branch from the session
  status      text not null,            -- 'ready' | 'no-remote' | 'not-a-repo'
  last_active timestamptz,              -- newest session mtime for this path
  updated_at  timestamptz not null default now(),
  primary key (owner_id, cwd)
);

-- RLS mirrors the other tables: permissive public policy (scoping is enforced by
-- owner_id in the API/RPC, since the worker uses the publishable key, no JWT).
alter table public.worker_repos enable row level security;

drop policy if exists "public all worker_repos" on public.worker_repos;
create policy "public all worker_repos"
  on public.worker_repos for all
  using (true) with check (true);

-- Replace the owner's discovered set atomically. Passing the whole list in one
-- jsonb arg keeps it to a single round-trip from the worker's sweep.
create or replace function public.report_worker_repos(
  p_owner_id uuid,
  p_repos    jsonb
)
  returns void
  language plpgsql
as $$
begin
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
