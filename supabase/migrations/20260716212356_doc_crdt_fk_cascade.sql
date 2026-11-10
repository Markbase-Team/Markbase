-- Tie a document's CRDT to the document itself.
--
-- doc_crdt.doc_id was text with no foreign key, so deleting a document left its
-- CRDT snapshot behind forever — every deleted doc leaked a row, and a later doc
-- could never be told apart from the debris. Make it a real uuid reference that
-- cascades.
--
-- Order matters: dangling rows must go before the constraint can be added.
delete from docs.doc_crdt c
where not exists (select 1 from docs.documents d where d.id::text = c.doc_id);

alter table docs.doc_crdt alter column doc_id type uuid using doc_id::uuid;

alter table docs.doc_crdt
  add constraint doc_crdt_doc_id_fkey
  foreign key (doc_id) references docs.documents (id) on delete cascade;
