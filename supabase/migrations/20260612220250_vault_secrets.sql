-- Encrypted secret vault. The server is a zero-knowledge blob store: it only
-- ever holds ciphertext that the client produced (AES-256-GCM, key derived from
-- a vault passphrase via scrypt). The passphrase and plaintext NEVER reach the
-- server, so even with DB access the secrets can't be read. Access is gated by
-- an API key at the API layer; the api_key is only for auth, not encryption.
create table if not exists public.vault_secrets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  salt       text not null,        -- base64 (scrypt salt)
  nonce      text not null,        -- base64 (GCM nonce)
  ciphertext text not null,        -- base64 (GCM ciphertext + 16-byte tag)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vault_secrets_name_uniq
  on public.vault_secrets (lower(name));

alter table public.vault_secrets enable row level security;
drop policy if exists "public all vault_secrets" on public.vault_secrets;
create policy "public all vault_secrets" on public.vault_secrets
  for all using (true) with check (true);
