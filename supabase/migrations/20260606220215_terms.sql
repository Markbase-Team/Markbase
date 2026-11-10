-- Terms glossary: enter a term, get an AI definition, then chat to learn more.
-- Mirrors the reader's selection + messages model.

create table if not exists public.terms (
  id         uuid primary key default gen_random_uuid(),
  term       text not null,
  definition text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.term_messages (
  id         uuid primary key default gen_random_uuid(),
  term_id    uuid not null references public.terms(id) on delete cascade,
  question   text not null,
  answer     text not null,
  created_at timestamptz not null default now()
);
create index if not exists term_messages_term_idx
  on public.term_messages (term_id, created_at);

-- RLS: permissive public like the other admin tables (gated by the admin API).
alter table public.terms enable row level security;
drop policy if exists "public all terms" on public.terms;
create policy "public all terms" on public.terms
  for all using (true) with check (true);

alter table public.term_messages enable row level security;
drop policy if exists "public all term_messages" on public.term_messages;
create policy "public all term_messages" on public.term_messages
  for all using (true) with check (true);
