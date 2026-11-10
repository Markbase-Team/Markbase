create table if not exists public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ticket_messages_ticket
  on public.ticket_messages(ticket_id, created_at);

alter table public.ticket_messages enable row level security;

drop policy if exists "public all ticket_messages" on public.ticket_messages;
create policy "public all ticket_messages" on public.ticket_messages
  for all using (true) with check (true);;
