-- One row per instance: the invite code its join link carries.
--
-- A self-hosted Markbase admits a teammate through its /join page, and the
-- link an existing member shares (Settings → Invite your team) carries this
-- code; a bare /join offers no sign-up. Rotating the code is how a leaked link
-- is revoked. The row is the API's alone: the server reads and rotates it with
-- the secret key, the join page verifies against it, and no browser key can
-- see it. It is created on first use by the server, not here, so the code is
-- drawn from the server's CSPRNG rather than a SQL default.
create table public.instance_settings (
  singleton boolean primary key default true check (singleton),
  invite_code text not null,
  invite_rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.instance_settings enable row level security;

-- No policies: the public roles are refused outright. The secret key's role
-- gets its grant explicitly — it does not inherit from PUBLIC after a revoke
-- (see 20261029190000_crdt_changes_service_role.sql).
revoke all on public.instance_settings from public, anon, authenticated;
grant select, insert, update on public.instance_settings to service_role;
