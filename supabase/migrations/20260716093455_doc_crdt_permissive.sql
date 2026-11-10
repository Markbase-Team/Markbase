-- Match the docs.documents model: RLS on, but a permissive policy — real authz
-- is enforced at the API/capability layer, and the worker uses the anon
-- publishable key (no user session), so it needs anon access here.
drop policy if exists doc_crdt_member_access on docs.doc_crdt;
-- The preceding doc_crdt migration already creates a policy of this name, so a
-- rebuild from scratch hits it here. It never collided in production, where
-- this ran against a database that had the older member-access policy instead.
drop policy if exists permissive on docs.doc_crdt;
create policy permissive on docs.doc_crdt for all using (true) with check (true);
grant usage on schema docs to anon;
grant select, insert, update, delete on docs.doc_crdt to anon;;
