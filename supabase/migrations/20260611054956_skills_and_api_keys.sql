-- Agent API: lets external agents (e.g. Claude) pull Claude Code skills and
-- push skills / learnings / terms into this project, authenticated by an API
-- key. The admin (logged-in session) can also call the same endpoints key-free.

-- Claude Code skills stored here. Each row is a /-callable skill: a name
-- (kebab-case, used as the skill dir + URL), a one-line description, and the
-- markdown body. The served SKILL.md is assembled as frontmatter + body.
create table if not exists public.skills (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  body        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- One skill per name (case-insensitive).
create unique index if not exists skills_name_uniq
  on public.skills (lower(name));

-- API keys for programmatic (agent) access. Only a SHA-256 hash of the token is
-- stored — the plaintext is shown once at creation and never persisted. A short
-- prefix is kept for display. Revoking a key deletes its row.
create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null default '',
  key_prefix   text not null,
  key_hash     text not null unique,
  scopes       text[] not null default '{read,write}',
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists api_keys_key_hash_idx on public.api_keys (key_hash);

-- RLS: permissive public like the other app tables (access is gated by the API
-- layer; api_keys stores only non-reversible hashes).
alter table public.skills enable row level security;
drop policy if exists "public all skills" on public.skills;
create policy "public all skills" on public.skills
  for all using (true) with check (true);

alter table public.api_keys enable row level security;
drop policy if exists "public all api_keys" on public.api_keys;
create policy "public all api_keys" on public.api_keys
  for all using (true) with check (true);
