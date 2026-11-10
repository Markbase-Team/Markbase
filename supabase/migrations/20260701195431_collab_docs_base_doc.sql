-- Store the document's v0 snapshot so any historical version can be
-- reconstructed by replaying steps from it (base_doc + steps[0..V]) — powering
-- the inline revision diff without per-save snapshots.
alter table docs.documents add column if not exists base_doc jsonb;
update docs.documents set base_doc = doc_json where base_doc is null;
