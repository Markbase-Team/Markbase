-- Multi-file skills. A skill's SKILL.md (the Instructions) stays in skills.body;
-- these rows hold the bundled extras — Scripts, References, and Assets — each at
-- its relative path within the skill directory. Storing files individually (not
-- as one opaque tarball) lets the dashboard show/edit each file in the markdown
-- editor; the install bundle (.tar.gz) is assembled on the fly from body + these
-- rows at request time.
create table if not exists public.skill_files (
  id         uuid primary key default gen_random_uuid(),
  skill_id   uuid not null references public.skills(id) on delete cascade,
  -- Relative POSIX path inside the skill dir, e.g. "scripts/validate.sh".
  path       text not null,
  -- UTF-8 text content. (Binary assets aren't supported yet.)
  content    text not null default '',
  -- chmod +x on install (scripts). Maps to mode 0755 vs 0644 in the tarball.
  executable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (skill_id, path)
);
create index if not exists skill_files_skill_idx on public.skill_files (skill_id);

-- RLS: permissive public like skills/api_keys; access is gated at the API layer.
alter table public.skill_files enable row level security;
drop policy if exists "public all skill_files" on public.skill_files;
create policy "public all skill_files" on public.skill_files
  for all using (true) with check (true);
