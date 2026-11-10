-- Per-project secrets vault (API keys, tokens). Values are stored encrypted
-- with AES-256-GCM; the 32-byte key lives in the SECRETS_ENCRYPTION_KEY env var
-- (never in the database), so a row/table leak yields only ciphertext.

create table if not exists public.secrets (
  id          uuid primary key default gen_random_uuid(),
  project     text not null references public.projects(slug)
                on update cascade on delete cascade,
  name        text not null,
  description text not null default '',
  -- AES-256-GCM ciphertext + per-row iv + auth tag, all base64.
  ciphertext  text not null,
  iv          text not null,
  auth_tag    text not null,
  -- Masked preview (last 4 chars of plaintext) for the list. Not sensitive.
  preview     text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists secrets_project_idx on public.secrets (project);

-- One secret name per project (case-insensitive).
create unique index if not exists secrets_project_name_uniq
  on public.secrets (project, lower(name));

alter table public.secrets enable row level security;

-- SECURITY: unlike the other admin tables (which use a permissive "public all"
-- policy the browser-exposed publishable/anon key can satisfy), secrets are
-- reachable ONLY by an authenticated session. The anon role has no policy, so
-- it is denied; the app accesses this table through the cookie-bound
-- authenticated server client. (The service-role key still bypasses RLS for
-- the trusted local worker.)
drop policy if exists "secrets authenticated all" on public.secrets;
create policy "secrets authenticated all"
  on public.secrets for all
  to authenticated
  using (true) with check (true);
