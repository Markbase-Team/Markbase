-- Remember where you left off in each PDF: reopening jumps to this page.
alter table public.reader_documents
  add column if not exists last_page integer not null default 1;
