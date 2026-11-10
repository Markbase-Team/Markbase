alter table public.tickets
  add column if not exists cc_branch text,
  add column if not exists pr_title text,
  add column if not exists pr_id text,
  add column if not exists pr_url text,
  add column if not exists commits jsonb not null default '[]'::jsonb;;
