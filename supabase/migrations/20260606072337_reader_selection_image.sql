-- Area selections: a selection can be an image (a cropped region of a page)
-- instead of (or in addition to) quoted text. image_url points at the cropped
-- PNG in the reader-pdfs bucket; text may be empty for image selections.
alter table public.reader_selections
  add column if not exists image_url text;
