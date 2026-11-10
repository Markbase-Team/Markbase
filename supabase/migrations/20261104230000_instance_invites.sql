-- The addresses a team instance has invited.
--
-- Inviting is two steps a member takes in Settings: add the teammate's
-- address here, then hand them the join link. The join page creates an
-- account only for an address on this list (and, on a fresh instance, for
-- the first account, which has nobody to invite it). Nothing is mailed:
-- Markbase has no mailer and does not want one for this, so the link travels
-- however the team talks. A row's accepted_at is set when the account exists.
--
-- The table is the API's alone, like instance_settings: the server reads and
-- writes it with the secret key; no browser key can see who was invited.
create table public.instance_invites (
  email text primary key check (email = lower(email)),
  invited_by uuid,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

alter table public.instance_invites enable row level security;

revoke all on public.instance_invites from public, anon, authenticated;
grant select, insert, update, delete on public.instance_invites to service_role;
