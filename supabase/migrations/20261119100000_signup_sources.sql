-- Where each account came from.
--
-- A sign-up used to leave no trace of how the person found us: auth.users
-- holds what Google handed back, the session's IP is our own server's, and
-- the landing page's analytics cannot name an account. So "did this one come
-- from Reddit or from search?" had no answer.
--
-- The browser now notes the FIRST visit — referrer, landing URL, utm_* — in a
-- cookie (apps/web/src/lib/signup-source.ts), and the server copies it here
-- the moment that browser turns into a new account: the OAuth callback, or
-- POST /api/signup-source right after an email sign-up. One row per account,
-- written once; a later sign-in never overwrites it.
--
-- The table is the API's alone, like instance_invites: the server writes it
-- with the secret key, and no browser key can read anyone's origin.
create table public.signup_sources (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  referrer      text,
  landing_path  text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_term      text,
  utm_content   text,
  -- When the browser first saw the person; created_at is when the account did.
  first_seen_at timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.signup_sources enable row level security;

revoke all on public.signup_sources from public, anon, authenticated;
grant select, insert, update, delete on public.signup_sources to service_role;
