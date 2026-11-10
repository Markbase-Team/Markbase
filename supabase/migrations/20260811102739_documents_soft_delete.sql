-- Soft delete for documents.
--
-- doc_crdt references documents ON DELETE CASCADE, so a hard delete destroys the
-- CRDT with the row — and the CRDT is the text, the comments and the entire
-- version history. That is fine for an explicit "delete this document" in the UI,
-- but it must never be what a missing FILE on disk triggers: a stray rm, a bad
-- git checkout or a sync hiccup would be unrecoverable.
--
-- So deletion becomes reversible. The vault daemon already trashes rather than
-- removes when a document leaves the cloud; this makes the reverse symmetric —
-- neither side destroys anything on the other's say-so.
alter table docs.documents add column if not exists deleted_at timestamptz;

comment on column docs.documents.deleted_at is
  'When this document was moved to trash. Non-null rows are excluded from every list, search and read; the CRDT is kept so a restore loses nothing.';

-- Every read path filters on this, so index the live rows a vault asks for.
create index if not exists documents_vault_live_idx
  on docs.documents (vault_id)
  where deleted_at is null;;
