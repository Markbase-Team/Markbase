-- An editable title for a reader selection's toggle. Empty falls back to the
-- quoted text (or "Image selection") in the UI.
alter table public.reader_selections
  add column if not exists title text not null default '';
