-- Where an account's machines hear that something changed.
--
-- A vault sync used to ask the API what moved every few seconds, whether or
-- not anything had: about 40,000 requests a day from one idle desktop app.
-- Now the server nudges it instead, through Supabase Realtime, after a write;
-- the sync then asks once (packages/shared/src/sync-nudges.ts).
--
-- One topic per account. It is the name of a public broadcast channel, so it
-- is made unguessable here and handed only to that account's machines
-- (GET /api/v1/vaults/sync). A nudge carries nothing but "content" or "structure",
-- so a topic that leaked would tell someone only that the account changed
-- something, and when; deleting the row and asking again gives a new one.
--
-- The API's alone, like signup_sources: the server reads and writes it with
-- the secret key, and no browser key can read anyone's topic.
create table public.sync_nudge_topics (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  topic      text not null unique,
  created_at timestamptz not null default now()
);

alter table public.sync_nudge_topics enable row level security;

revoke all on public.sync_nudge_topics from public, anon, authenticated;
grant select, insert, update, delete on public.sync_nudge_topics to service_role;
