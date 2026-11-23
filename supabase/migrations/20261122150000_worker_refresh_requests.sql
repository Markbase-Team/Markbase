-- Lookups the web server asks a worker to run in a project's local repo.
--
-- Three routes used to run git, gh and the Vercel CLI inside the web server's
-- own process, against projects.local_path: listing a project's branches,
-- checking a ticket's PR for a review request, and finding its preview URL.
-- That only worked when the web server ran on the machine holding the
-- checkout, so never on the hosted site. The checkout is on the worker's
-- machine, so the worker runs them now.
--
-- worker_refresh_requests is the ask: one row per ticket or project that
-- wants a fresh answer. The worker is handed the pending ones on its idle
-- claim, runs the lookup and posts the result; the API deletes the row then.
-- A row nobody answers stops being offered after ten minutes (the API filters
-- on requested_at) and is replaced by the next request for the same thing.
--
-- projects.branches is the answer for a project: the branch list the worker
-- last reported, with the time, as
--   { "branches": [...], "default": "main", "current": "main", "at": "..." }
-- A ticket's answer needs no new column: it lands in the ticket's existing
-- commits, pr_* and preview_url fields.
--
-- The table is the API's alone: the server writes it with the secret key.
create table public.worker_refresh_requests (
  owner_id     uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('ticket', 'project')),
  ref          text not null,            -- ticket id, or project slug
  requested_at timestamptz not null default now(),
  primary key (owner_id, kind, ref)
);

alter table public.worker_refresh_requests enable row level security;

revoke all on public.worker_refresh_requests from public, anon, authenticated;
grant select, insert, update, delete on public.worker_refresh_requests to service_role;

alter table public.projects add column if not exists branches jsonb;
