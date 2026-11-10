-- Attention boards + items. Idempotent: safe to run repeatedly.
-- RLS is enabled with NO policies → only a service-role / direct Postgres
-- connection can read or write. The app talks to these tables with the
-- service-role key; this CLI runs DDL over a direct Postgres connection.

create table if not exists public.attention_boards (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  color          text not null default '#e5ff6e',
  sender_domains text[] not null default '{}',
  keywords       text[] not null default '{}',
  rules          text not null default '',
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.attention_items (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.attention_boards(id) on delete cascade,
  account_id  uuid,
  message_id  text not null,
  thread_id   text,
  from_addr   text not null default '',
  subject     text not null default '',
  snippet     text not null default '',
  summary     text not null default '',
  email_date  text not null default '',
  status      text not null default 'filed',
  created_at  timestamptz not null default now()
);

create index if not exists attention_items_board_id_idx
  on public.attention_items (board_id);

create unique index if not exists attention_items_board_message_uniq
  on public.attention_items (board_id, message_id);

alter table public.attention_boards enable row level security;
alter table public.attention_items enable row level security;
