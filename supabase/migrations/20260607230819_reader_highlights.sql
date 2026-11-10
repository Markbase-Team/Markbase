-- PDF highlights: colored overlays over selected text. `rects` is an array of
-- page-normalized boxes ({x,y,w,h} in 0..1) so they redraw at any page size.
create table if not exists public.reader_highlights (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.reader_documents(id) on delete cascade,
  page        integer not null,
  rects       jsonb not null default '[]'::jsonb,
  color       text not null default 'yellow',
  created_at  timestamptz not null default now()
);
create index if not exists reader_highlights_document_idx
  on public.reader_highlights (document_id);

alter table public.reader_highlights enable row level security;
drop policy if exists "public all reader_highlights" on public.reader_highlights;
create policy "public all reader_highlights" on public.reader_highlights
  for all using (true) with check (true);
