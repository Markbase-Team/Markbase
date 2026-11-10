-- Manual ordering for the "Today!" list so todos can be drag-reordered (dnd-kit).
-- Existing rows default to position 0; listTodos sorts by position then
-- created_at, so current rows keep their insertion order until reordered.
alter table public.today_todos
  add column if not exists position integer not null default 0;

create index if not exists today_todos_day_position_idx
  on public.today_todos (day, position, created_at);
