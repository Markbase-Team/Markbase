-- Per-project Work Logs: each project's "document" is its set of logs. Each row
-- is a log (a sub-document) with an OPTIONAL date (dated or not dated), a title,
-- and markdown content.
create table if not exists public.work_logs (
  id         uuid primary key default gen_random_uuid(),
  project    text not null references public.projects(slug) on update cascade on delete cascade,
  entry_date date,                       -- nullable: "dated or not dated"
  title      text not null default '',
  content    text not null default '',
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists work_logs_project_idx on public.work_logs (project);

-- RLS: permissive public like the other app tables (access is gated at the API
-- layer).
alter table public.work_logs enable row level security;
drop policy if exists "public all work_logs" on public.work_logs;
create policy "public all work_logs" on public.work_logs
  for all using (true) with check (true);
