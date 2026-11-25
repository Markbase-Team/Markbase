-- Document properties, indexed for filtering and sorting (doc types, step 2;
-- design: "Doc types v2: fixed core, user types, rules" in the Markbase vault).
--
-- A document's properties are its front matter. The file is the truth; what is
-- here is a copy the server keeps so views can filter and sort across a vault
-- of any size without reading every document. It is rebuilt from the text on
-- every save, and can be rebuilt from scratch at any time
-- (scripts/backfill-properties.ts).
--
-- The indexes are fixed. They are on the key and the value, never on a
-- particular field, so a field a team adds tomorrow is new rows, not a new
-- index: an index per field on shared tables would grow without bound, slow
-- every write, and lock the table each time one was built.
--
--   - documents.properties (jsonb) with a GIN index: "field = value" on any
--     field (properties @> '{"severity": "sev1"}').
--   - doc_properties: one row per document per field (per item, for a list;
--     nested keys flattened to "a.b"), with the value in a column of its kind:
--     ranges and sorting on any field.
--
-- Server only, like the rest of a document's text: the public roles get
-- nothing.

alter table docs.documents add column properties jsonb not null default '{}'::jsonb;
create index documents_properties_gin on docs.documents using gin (properties jsonb_path_ops);

create table docs.doc_properties (
  doc_id    uuid not null references docs.documents (id) on delete cascade,
  vault_id  uuid,
  key       text not null,
  -- Always set: equality and "is one of" on any value.
  v_text    text not null,
  -- Set when the value reads as one: a number, a date or date-time, a boolean.
  v_num     numeric,
  v_date    timestamptz,
  v_bool    boolean
);

create index doc_properties_doc_idx  on docs.doc_properties (doc_id);
create index doc_properties_text_idx on docs.doc_properties (vault_id, key, v_text);
create index doc_properties_num_idx  on docs.doc_properties (vault_id, key, v_num) where v_num is not null;
create index doc_properties_date_idx on docs.doc_properties (vault_id, key, v_date) where v_date is not null;

alter table docs.doc_properties enable row level security;
revoke all on table docs.doc_properties from anon, authenticated;

-- Replace one document's properties, in one transaction. Does nothing when the
-- front matter is what it was, which is almost every save: the editor saves
-- every few seconds while someone types in the body.
create function docs.set_doc_properties(doc uuid, props jsonb, rows jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  vault uuid;
begin
  update docs.documents d
     set properties = props
   where d.id = doc and d.properties is distinct from props
  returning d.vault_id into vault;
  if not found then
    return false;
  end if;

  delete from docs.doc_properties where doc_id = doc;
  insert into docs.doc_properties (doc_id, vault_id, key, v_text, v_num, v_date, v_bool)
  select doc, vault, r.key, r.v_text, r.v_num, r.v_date, r.v_bool
    from jsonb_to_recordset(rows)
      as r(key text, v_text text, v_num numeric, v_date timestamptz, v_bool boolean);
  return true;
end;
$$;

revoke all on function docs.set_doc_properties(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function docs.set_doc_properties(uuid, jsonb, jsonb) to service_role;
