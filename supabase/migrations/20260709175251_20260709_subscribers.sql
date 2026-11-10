-- Email capture for the landing "Stay in touch" form. One row per address;
-- case-insensitive unique so the same email can't sign up twice.
create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'landing',
  created_at timestamptz not null default now()
);

create unique index if not exists subscribers_email_key
  on public.subscribers (lower(email));
