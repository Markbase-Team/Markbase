-- On-demand repo rescan: let the admin UI ask the worker to re-scan now, instead
-- of waiting for the background sweep (which runs every ~30 min).
--
-- The web app can't call into the worker directly (the worker only polls), so we
-- pass the request through a flag on the workers row: the UI sets it, and the
-- worker atomically takes (reads + clears) it on its next idle poll, then sweeps.

alter table public.workers
  add column if not exists rescan_requested_at timestamptz;

-- Web → set the flag. Upsert so it works even before the worker's first poll;
-- seed last_poll_at in the past so a never-connected worker doesn't read as live.
create or replace function public.request_repo_rescan(p_owner_id uuid)
  returns void
  language plpgsql
as $$
begin
  insert into public.workers (owner_id, last_poll_at, rescan_requested_at)
    values (p_owner_id, 'epoch', now())
    on conflict (owner_id) do update
      set rescan_requested_at = now();
end;
$$;

-- Worker → atomically take the flag. Returns true exactly once per request, so a
-- rescan fires for one poll cycle and not repeatedly.
create or replace function public.take_repo_rescan(p_owner_id uuid)
  returns boolean
  language plpgsql
as $$
declare
  requested boolean;
begin
  update public.workers
    set rescan_requested_at = null
    where owner_id = p_owner_id and rescan_requested_at is not null
    returning true into requested;
  return coalesce(requested, false);
end;
$$;
