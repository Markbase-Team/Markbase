-- Media in a vault (roadmap A6): binary assets alongside the markdown.
--
-- The markdown holds a VAULT-RELATIVE path ("assets/diagram.png"), never a URL —
-- that's what keeps a vault working in Obsidian, in git, and offline. This table
-- is the index that lets each surface RESOLVE such a path: the web maps it to a
-- storage URL to render, the daemon maps it to bytes to write on disk.
--
-- Objects are CONTENT-ADDRESSED: the storage key is "<vault_id>/<sha256>", not the
-- path. Three things fall out for free:
--   * the same image pasted into five docs stores one object;
--   * an object is immutable, so it can be cached forever with no invalidation;
--   * renaming or moving an asset is a row update — the bytes never move.
-- Which is why `path` and `sha256` are separate columns: the path is where a human
-- filed it, the hash is what it IS.
create table if not exists docs.assets (
  id           uuid primary key default gen_random_uuid(),
  vault_id     uuid not null references docs.vaults (id) on delete cascade,
  -- Vault-relative, POSIX separators — the exact string the markdown references.
  path         text not null,
  -- Hex sha256 of the bytes; also the storage object key within the vault.
  sha256       text not null,
  size_bytes   bigint not null,
  content_type text,
  owner_id     uuid not null,
  created_at   timestamptz not null default now(),
  -- One asset per path per vault: the markdown's reference must be unambiguous.
  unique (vault_id, path)
);

create index if not exists assets_vault_id_idx on docs.assets (vault_id);
-- Answers "is anything else still using these bytes?" before deleting an object.
create index if not exists assets_sha256_idx on docs.assets (vault_id, sha256);

grant select, insert, update, delete on docs.assets to anon, authenticated, service_role;

-- Same model as the rest of docs.*: RLS on, permissive policy, real authz at the
-- API/capability layer.
alter table docs.assets enable row level security;
drop policy if exists permissive on docs.assets;
create policy permissive on docs.assets for all using (true) with check (true);

-- The bucket is PRIVATE, unlike ticket-images/reader-pdfs. Those hold things the
-- user chose to attach to shared work; this holds whatever they pasted into a
-- private notebook. A public bucket is a capability URL that never expires, and
-- URLs leak — through referrers, history, screenshots. Reads go through signed
-- URLs so the blast radius of a leaked link is its TTL, not forever.
insert into storage.buckets (id, name, public, file_size_limit)
values ('vault-assets', 'vault-assets', false, 26214400)  -- 25 MB
on conflict (id) do nothing;
