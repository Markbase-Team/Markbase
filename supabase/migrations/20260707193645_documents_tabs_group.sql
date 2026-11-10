-- Document tabs (Google-Docs style): a "logical document" is a group of document
-- rows sharing tab_group_id; each tab is a full document. `position` orders them.
alter table docs.documents
  add column if not exists tab_group_id uuid not null default gen_random_uuid(),
  add column if not exists position integer not null default 0;

-- Existing docs each become their own single-tab group.
update docs.documents set tab_group_id = id;

create index if not exists documents_tab_group_idx
  on docs.documents (tab_group_id, position);
