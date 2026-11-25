-- The candidates for a view (doc types, step 4; design: "Doc types v2: fixed
-- core, user types, rules" in the Markbase vault).
--
-- A view (filter, sort, groups) is evaluated by the app; this narrows what it
-- has to look at, with the property index: documents the account can open
-- (its own, or shared with it), not in the trash, whose front matter contains
-- `contains` (properties @> contains, the GIN index). Nothing here knows about
-- any kind of document: Today is a view whose `contains` is {"type": "task"}.
--
-- Newest first, at most `max_rows`. Server only, like the tables it reads.

create function docs.query_documents(me uuid, contains jsonb, max_rows integer default 1000)
returns table (
  id uuid,
  title text,
  path text,
  vault_id uuid,
  owner_id uuid,
  updated_at timestamptz,
  properties jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.id, d.title, d.path, d.vault_id, d.owner_id, d.updated_at, d.properties
    from docs.documents d
   where d.deleted_at is null
     and d.properties @> coalesce(contains, '{}'::jsonb)
     and (d.owner_id = me or exists (select 1 from docs.members m where m.doc_id = d.id and m.user_id = me))
   order by d.updated_at desc
   limit greatest(1, least(max_rows, 5000));
$$;

revoke all on function docs.query_documents(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function docs.query_documents(uuid, jsonb, integer) to service_role;
