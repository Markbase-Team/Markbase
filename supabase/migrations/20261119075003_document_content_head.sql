-- The first kilobyte of each document's markdown, kept by Postgres.
--
-- The sidebar shows a line or two of every document under its title. That
-- text comes from `content`, and the list endpoints deliberately do not select
-- `content`: the bodies are the bulk of a row, and pulling fifty of them to
-- show a hundred characters each is what used to leave the sidebar on
-- "Loading…" for seconds. A generated column gives the list the head of the
-- body at the cost of one small text value per row, recomputed by Postgres on
-- every content write — so it is never stale and nothing has to remember to
-- update it. The API turns it into prose (frontmatter and the leading h1
-- dropped, markdown punctuation stripped) before it leaves the server.
alter table docs.documents
  add column content_head text generated always as (left(content, 1000)) stored;
