-- Projects table
create table if not exists public.projects (
  slug text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

-- Ticket status + owner enums
do $$ begin
  create type ticket_status as enum (
    'requested', 'ready_to_execute', 'in_progress', 'need_review', 'done'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type ticket_owner as enum ('jessie', 'agent');
exception when duplicate_object then null; end $$;

-- Tickets table
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  project text not null references public.projects(slug) on delete cascade,
  title text not null,
  description text not null,
  requester text not null,
  owner ticket_owner not null default 'jessie',
  status ticket_status not null default 'requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tickets_project on public.tickets(project);
create index if not exists idx_tickets_status on public.tickets(status);
create index if not exists idx_tickets_owner on public.tickets(owner);

-- keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_tickets_updated_at on public.tickets;
create trigger trg_tickets_updated_at
  before update on public.tickets
  for each row execute function public.set_updated_at();

-- Seed initial project
insert into public.projects (slug, name) values ('cba', 'CBA')
  on conflict (slug) do nothing;

-- Row Level Security: enable, then allow public (anon) access for this
-- single-tenant tool. Tighten with auth later if needed.
alter table public.projects enable row level security;
alter table public.tickets enable row level security;

drop policy if exists "public read projects" on public.projects;
create policy "public read projects" on public.projects
  for select using (true);

drop policy if exists "public all tickets" on public.tickets;
create policy "public all tickets" on public.tickets
  for all using (true) with check (true);;
