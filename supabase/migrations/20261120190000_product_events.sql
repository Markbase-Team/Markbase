-- What people do in the app that leaves no other trace.
--
-- Most of what an account does is visible in its own rows: a vault, a
-- document, an API key. Some of it is not. The "Connect an agent" modal that
-- follows a first vault can be shown, skipped, or clicked through to an agent
-- that is then never set up, and all three look the same afterwards: no key.
-- So "did they see it, and what did they do?" had no answer.
--
-- The page now reports those moments to POST /api/v1/events, which writes one
-- row each here. The names a row may carry are a fixed list in
-- packages/core/protocol/src/product-events.ts; anything else is refused.
--
-- The table is the API's alone, like signup_sources: the server writes it with
-- the secret key, and no browser key can read anyone's events.
create table public.product_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index product_events_user_created on public.product_events (user_id, created_at);
create index product_events_name_created on public.product_events (name, created_at);

alter table public.product_events enable row level security;

revoke all on public.product_events from public, anon, authenticated;
grant select, insert, update, delete on public.product_events to service_role;
