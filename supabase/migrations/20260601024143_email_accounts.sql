-- Connected Gmail accounts for the admin Inbox.
-- Holds the OAuth refresh token (encrypted at the app layer with AES-256-GCM).
-- RLS is ENABLED with NO policies → the publishable/anon key cannot read or
-- write this table; only the service-role key (which bypasses RLS) can.
create table if not exists public.email_accounts (
  id                uuid primary key default gen_random_uuid(),
  email_address     text unique not null,
  google_sub        text,
  display_name      text,
  refresh_token_enc text not null,
  scopes            text[],
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.email_accounts enable row level security;
-- Intentionally no policies: deny all access except service-role.
