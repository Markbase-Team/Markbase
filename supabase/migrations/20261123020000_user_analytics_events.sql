-- What happened to a customer's vaults and documents, and who did it.
--
-- product_events is OUR telemetry: a modal shown, a button pressed. This table
-- is the customer's: every read, write, search and tool call a person or an
-- agent makes on their data, so "which agents touched my vault this week?" and
-- "what did Claude try to do after it connected?" have an answer. Until now
-- the only trace of an agent was api_keys.last_used_at, once every five
-- minutes, with no word on what it asked for.
--
-- One row per action. It says whose data was touched (owner_id), who acted
-- (a person, or an agent under one of the owner's keys), through which door
-- (channel), what was asked (action — an endpoint or tool id, never its
-- arguments) and how it ended. It holds no document content and no argument
-- values.
--
-- vault_id and doc_id are plain ids with no foreign key on purpose: the row
-- outlives the thing it describes, so "an agent deleted this document" is
-- still there to read after the document is gone.
--
-- Written only by the API (packages/platform/server/src/analytics/
-- user-analytics-store.ts) with the secret key. No browser key can read it;
-- a customer reads their own rows through the API, which checks what they may
-- see.
-- The door an action came through: an MCP tool call, a plain API request, an
-- agent's hook on the person's machine, or the app itself.
create type public.user_analytics_channel as enum ('mcp', 'api', 'hook', 'app');

-- How it ended. 'denied' is a refusal for lack of permission (a key's ceiling,
-- a document someone may not open); 'error' is every other failure.
create type public.user_analytics_outcome as enum ('success', 'denied', 'error');

-- Who acted.
create type public.user_analytics_actor as enum ('person', 'agent');

create table public.user_analytics_events (
  id          bigint generated always as identity primary key,
  -- Whose data this is. Their rows go when the account does.
  owner_id    uuid not null references auth.users (id) on delete cascade,
  actor_kind  public.user_analytics_actor not null,
  -- For an agent: the key it used, the tool that holds the key (claude, codex,
  -- cursor…) and the MCP client's own name when it gave one. The key id stays
  -- readable after the key is revoked, so it is not a foreign key either.
  key_id      uuid,
  provider    text,
  client      text,
  channel     public.user_analytics_channel not null,
  -- An endpoint or tool id, or an MCP method. Text, not an enum: the set grows
  -- with every endpoint the API gains, and the code is what knows it.
  action      text not null,
  vault_id    uuid,
  doc_id      uuid,
  outcome     public.user_analytics_outcome not null,
  status      integer,
  duration_ms integer,
  created_at  timestamptz not null default now()
);

-- "My activity, newest first" and its per-vault and per-document cuts.
create index user_analytics_events_owner on public.user_analytics_events (owner_id, id desc);
create index user_analytics_events_doc on public.user_analytics_events (doc_id, id desc) where doc_id is not null;
create index user_analytics_events_vault on public.user_analytics_events (vault_id, id desc) where vault_id is not null;

alter table public.user_analytics_events enable row level security;

revoke all on public.user_analytics_events from public, anon, authenticated;
grant select, insert, update, delete on public.user_analytics_events to service_role;
