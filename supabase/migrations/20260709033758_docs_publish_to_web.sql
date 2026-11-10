-- Publish-to-web: a doc becomes a public page at /p/<public_slug> when
-- published_at is set. public_slug is stable (kept across unpublish/republish).
alter table docs.documents
  add column if not exists public_slug text unique,
  add column if not exists published_at timestamptz;

create index if not exists documents_published_idx
  on docs.documents (published_at)
  where published_at is not null;
