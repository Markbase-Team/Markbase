-- Mint-after-confirm: a key is inert until the client that asked for it says it
-- arrived.
--
-- The device-auth flow minted a full-access key at the moment the browser
-- reached /cli-auth/approve, then redirected and hoped. When the redirect found
-- nothing listening -- a loopback that had timed out, a closed window, a browser
-- that never came back -- the key stayed valid anyway, sitting in an address bar
-- and in history. Five such keys existed on this account, all full access, none
-- ever used.
--
-- Now the client confirms receipt. An unconfirmed key authenticates nothing, and
-- the sweep below deletes it. A key that never reaches its app is dead by
-- default rather than live by default.

alter table public.api_keys
  add column if not exists confirmed_at timestamptz;

-- Every key that already exists was minted under the old contract and is in use
-- (or at least was legitimately issued), so it counts as confirmed. Only keys
-- created from here on, by a client that opted in, start out null.
update public.api_keys set confirmed_at = created_at where confirmed_at is null;

-- The sweep looks up unconfirmed keys by age; verification looks them up by hash
-- and must not pay for this column.
create index if not exists api_keys_unconfirmed_idx
  on public.api_keys (created_at)
  where confirmed_at is null;

comment on column public.api_keys.confirmed_at is
  'When the client acknowledged receiving this key. NULL means minted but never delivered: it authenticates nothing and is swept after 30 minutes. Legacy keys were backfilled to created_at.';

-- Delete keys that were minted but never acknowledged. Thirty minutes is well
-- past the fifteen-minute authorization window the desktop app allows, so a
-- slow-but-successful sign-in is never swept out from under itself.
create or replace function public.sweep_unconfirmed_api_keys()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.api_keys
  where confirmed_at is null
    and created_at < now() - interval '30 minutes';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.sweep_unconfirmed_api_keys() is
  'Deletes api_keys rows minted but never confirmed by their client. Scheduled every 15 minutes via pg_cron.';;
