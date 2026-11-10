-- Store one row per submission (a debounced save), not one per step/keystroke.
-- The collab version counter still advances per step (from_version..to_version),
-- but the durable record is the batch — so history isn't one-row-per-character.
-- Test data only at this point, so recreate cleanly.
drop table if exists docs.steps;

create table docs.steps (
  id           uuid primary key default gen_random_uuid(),
  doc_id       uuid not null references docs.documents(id) on delete cascade,
  from_version integer not null,
  to_version   integer not null,
  steps        jsonb not null,            -- array of ProseMirror steps in this save
  author_kind  text not null,
  author_id    uuid,
  author_name  text not null default '',
  created_at   timestamptz not null default now(),
  unique (doc_id, from_version)
);
create index steps_doc_idx on docs.steps (doc_id, from_version);

alter table docs.steps enable row level security;
create policy "permissive" on docs.steps for all using (true) with check (true);
grant all on docs.steps to anon, authenticated, service_role;
alter publication supabase_realtime add table docs.steps;
