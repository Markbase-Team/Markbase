-- Today todos: a simple per-day personal todo list shown on the admin "Today!"
-- page. Each row is one task for a given calendar day, with an optional markdown
-- `details` body. The page loads the rows for the viewer's local date, keeping
-- the "fresh list each day" behaviour of the original localStorage version.
--
-- RLS mirrors the other admin tables: enabled with a permissive public policy so
-- the web app's publishable key (used server-side behind the admin auth gate)
-- can read and write. Access control is enforced at the API layer.

create table if not exists public.today_todos (
  id         uuid primary key default gen_random_uuid(),
  day        date not null default current_date,
  text       text not null,
  done       boolean not null default false,
  details    text not null default '',
  created_at timestamptz not null default now()
);

-- Page query is "todos for a given day, in insertion order".
create index if not exists today_todos_day_idx
  on public.today_todos (day, created_at);

alter table public.today_todos enable row level security;

drop policy if exists "public all today_todos" on public.today_todos;
create policy "public all today_todos"
  on public.today_todos for all
  using (true) with check (true);
