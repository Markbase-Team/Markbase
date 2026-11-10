-- Reader: persist uploaded PDFs, the passages selected from them, and the
-- question/answer threads on each passage.

-- Public bucket for PDFs (mirrors ticket-images: public read + open upload,
-- gated by the admin app at the API layer; object names are random UUIDs).
insert into storage.buckets (id, name, public)
values ('reader-pdfs', 'reader-pdfs', true)
on conflict (id) do nothing;

drop policy if exists "reader-pdfs upload" on storage.objects;
create policy "reader-pdfs upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'reader-pdfs');

drop policy if exists "reader-pdfs read" on storage.objects;
create policy "reader-pdfs read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'reader-pdfs');

-- An uploaded PDF.
create table if not exists public.reader_documents (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  path       text not null, -- object path in the reader-pdfs bucket
  url        text not null, -- public URL react-pdf loads
  created_at timestamptz not null default now()
);

-- A passage selected from a document (one right-side toggle).
create table if not exists public.reader_selections (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.reader_documents(id) on delete cascade,
  page        integer not null,
  text        text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists reader_selections_document_idx
  on public.reader_selections (document_id, position, created_at);

-- A question + the model's answer, under one selection.
create table if not exists public.reader_messages (
  id           uuid primary key default gen_random_uuid(),
  selection_id uuid not null references public.reader_selections(id) on delete cascade,
  question     text not null,
  answer       text not null,
  created_at   timestamptz not null default now()
);
create index if not exists reader_messages_selection_idx
  on public.reader_messages (selection_id, created_at);

-- RLS: permissive public like the other admin tables; access is gated by the
-- admin API (the web app uses the publishable key server-side behind auth).
alter table public.reader_documents enable row level security;
drop policy if exists "public all reader_documents" on public.reader_documents;
create policy "public all reader_documents" on public.reader_documents
  for all using (true) with check (true);

alter table public.reader_selections enable row level security;
drop policy if exists "public all reader_selections" on public.reader_selections;
create policy "public all reader_selections" on public.reader_selections
  for all using (true) with check (true);

alter table public.reader_messages enable row level security;
drop policy if exists "public all reader_messages" on public.reader_messages;
create policy "public all reader_messages" on public.reader_messages
  for all using (true) with check (true);
