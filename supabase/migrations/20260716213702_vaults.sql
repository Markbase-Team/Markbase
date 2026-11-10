-- Multi-vault: a user can keep separate collections (Work, Personal), each
-- syncing to its own local folder.
--
-- A document's `path` is vault-RELATIVE ("projects/2026/q1.md"), so without a
-- vault it was ambiguous which folder it belonged to: the daemon simply synced
-- every document you could see into one directory. `vault_id` scopes it.
--
-- The vault→folder mapping is deliberately NOT stored here: a local path is
-- per-machine, so it lives in the CLI config / Electron settings. The cloud only
-- knows a vault exists and which documents are in it.
create table if not exists docs.vaults (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant usage on schema docs to anon, authenticated, service_role;
grant select, insert, update, delete on docs.vaults to anon, authenticated, service_role;

-- Same model as the rest of docs.*: RLS on, permissive policy, real authz at the
-- API/capability layer.
alter table docs.vaults enable row level security;
drop policy if exists permissive on docs.vaults;
create policy permissive on docs.vaults for all using (true) with check (true);

-- A document lives in exactly one vault. Cascade: deleting a vault deletes the
-- documents in it (a doc can't exist outside a vault).
alter table docs.documents
  add column if not exists vault_id uuid references docs.vaults (id) on delete cascade;

-- Backfill so nothing orphans: one default vault per owner, then everything they
-- own goes in it. Every existing doc is a tab in a group, and a group has one
-- owner, so tabs of the same document stay together.
insert into docs.vaults (name, owner_id)
select distinct 'My Vault', d.owner_id
from docs.documents d
where d.owner_id is not null
  and not exists (select 1 from docs.vaults v where v.owner_id = d.owner_id);

update docs.documents d
set vault_id = v.id
from docs.vaults v
where v.owner_id = d.owner_id and d.vault_id is null;

create index if not exists documents_vault_id_idx on docs.documents (vault_id);
create index if not exists vaults_owner_id_idx on docs.vaults (owner_id);
