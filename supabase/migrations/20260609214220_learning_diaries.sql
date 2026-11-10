-- Learning Diary: dated journal entries written in markdown. Each entry has a
-- date (the day being journaled), an optional title, and markdown content.
-- Entries are listed sorted by date (newest first). Mirrors the terms table's
-- permissive RLS (gated by the admin API).

create table if not exists public.learning_diaries (
  id         uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  title      text not null default '',
  content    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sorted by date (newest first), then most-recently created within a day.
create index if not exists learning_diaries_order_idx
  on public.learning_diaries (entry_date desc, created_at desc);

alter table public.learning_diaries enable row level security;
drop policy if exists "public all learning_diaries" on public.learning_diaries;
create policy "public all learning_diaries" on public.learning_diaries
  for all using (true) with check (true);
