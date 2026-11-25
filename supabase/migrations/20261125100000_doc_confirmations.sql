-- Confirmations: someone checked a document's text against its source and
-- found it right (doc types, layer 1; design: "Doc types v2: fixed core, user
-- types, rules" in the Markbase vault).
--
-- A confirmation is what a document's trust is worked out from, so it can't
-- live anywhere anyone can type: front matter is edited by people, the desktop
-- app, GitHub sync and agents alike, and a `verified: { by: human:... }` line
-- there would be a forged confirmation. Rows here are written only by the web
-- API (docs_verifyDoc), with the secret key, as the signed-in caller. The
-- public roles get nothing: no grants and no policies.
--
-- Append-only. A confirmation stops counting when the document's text next
-- changes in a meaningful way; it is never edited or deleted, so the history
-- of who vouched for what, when, stays.
create table docs.doc_confirmations (
  id          uuid primary key default gen_random_uuid(),
  doc_id      uuid not null references docs.documents (id) on delete cascade,
  -- The account behind the confirmation: the person, or the person whose
  -- agent it was.
  user_id     uuid not null,
  -- `human:<user id>` or `agent:<tool>`, as front matter and OKF name actors.
  actor       text not null check (actor ~ '^(human|agent):.+'),
  -- The version index the confirmation was made against (docs_history).
  version     integer not null check (version >= 0),
  created_at  timestamptz not null default now()
);

create index doc_confirmations_doc_idx on docs.doc_confirmations (doc_id, created_at);

alter table docs.doc_confirmations enable row level security;
revoke all on table docs.doc_confirmations from anon, authenticated;
