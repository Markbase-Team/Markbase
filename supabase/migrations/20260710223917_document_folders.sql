-- Document folders: a lightweight, per-owner folder tree that documents can be
-- filed into. A folder is just a named container owned by its creator; a
-- document points at (at most) one folder via documents.folder_id. Documents
-- with a null folder_id live at the top level ("unfiled").

create table if not exists docs.folders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'New folder',
  owner_id   uuid not null,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table docs.documents
  add column if not exists folder_id uuid
    references docs.folders(id) on delete set null;

create index if not exists folders_owner_idx    on docs.folders (owner_id, position);
create index if not exists documents_folder_idx on docs.documents (folder_id);

alter table docs.folders enable row level security;
drop policy if exists "permissive" on docs.folders;
create policy "permissive" on docs.folders for all using (true) with check (true);

grant all on docs.folders to anon, authenticated, service_role;;
