-- Column to hold uploaded image URLs on a ticket
alter table public.tickets
  add column if not exists images jsonb not null default '[]'::jsonb;

-- Public storage bucket for ticket images
insert into storage.buckets (id, name, public)
values ('ticket-images', 'ticket-images', true)
on conflict (id) do nothing;

-- Anyone (anon) may upload to this bucket — matches the public intake form.
drop policy if exists "ticket-images upload" on storage.objects;
create policy "ticket-images upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'ticket-images');

-- Public read of objects in this bucket.
drop policy if exists "ticket-images read" on storage.objects;
create policy "ticket-images read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'ticket-images');;
