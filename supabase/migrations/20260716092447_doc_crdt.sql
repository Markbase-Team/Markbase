-- CRDT snapshot storage for the local-vault sync engine (roadmap F1).
-- One row per document holding the latest Yjs state as base64 text. The worker
-- and the browser editor read/write this via SupabaseDocStore; live updates go
-- over a Realtime broadcast channel (crdt:<doc_id>), not this table.
create table if not exists docs.doc_crdt (
  doc_id     text primary key,
  state      text not null,
  updated_at timestamptz not null default now()
);

grant usage on schema docs to anon, authenticated, service_role;
grant select, insert, update, delete on docs.doc_crdt to anon, authenticated, service_role;

-- Same model as docs.documents: RLS is on but the policy is permissive; real
-- authz lives at the API/capability layer. The worker syncs with the anon
-- publishable key (no user session), so it needs anon access here.
alter table docs.doc_crdt enable row level security;
create policy permissive on docs.doc_crdt for all using (true) with check (true);
