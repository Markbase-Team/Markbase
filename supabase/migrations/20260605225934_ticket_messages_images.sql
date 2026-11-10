-- Let chat follow-up messages carry image/PDF attachments, like tickets do.
-- URLs point at the public ticket-images bucket. Existing rows default to none.
alter table public.ticket_messages
  add column if not exists images text[] not null default '{}';
