-- Store the highlighted text so the Highlights list can show it.
alter table public.reader_highlights
  add column if not exists text text not null default '';
