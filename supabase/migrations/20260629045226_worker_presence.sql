-- Worker presence: detect whether an owner has a live worker connected.
--
-- The worker only touched the server at startup (/api/v1/me) and while running a
-- job (heartbeat). When idle it left no trace, so we couldn't tell "no worker"
-- from "worker running but idle" — both leave tickets sitting in `queued`.
--
-- Fix: stamp a per-owner last_poll_at on the poll we already make every ~3s
-- (claim_next_job). "Connected" = polled within a small multiple of the poll
-- interval. No extra network call.

create table if not exists public.workers (
  owner_id       uuid primary key references auth.users (id) on delete cascade,
  last_poll_at   timestamptz not null default now(),
  worker_version text
);

-- RLS mirrors the other tables: permissive public policy (scoping is enforced by
-- owner_id in the API/RPC, since the worker uses the publishable key, no JWT).
alter table public.workers enable row level security;

drop policy if exists "public all workers" on public.workers;
create policy "public all workers"
  on public.workers for all
  using (true) with check (true);

-- Re-create claim_next_job to record the poll. p_version is optional so older
-- workers (which call with only p_owner_id) keep working unchanged.
drop function if exists public.claim_next_job(uuid);
create or replace function public.claim_next_job(
  p_owner_id uuid,
  p_version  text default null
)
  returns public.jobs
  language plpgsql
as $$
declare
  job public.jobs;
begin
  -- Presence stamp on EVERY poll, including the idle (no-job) path below.
  insert into public.workers (owner_id, last_poll_at, worker_version)
    values (p_owner_id, now(), p_version)
    on conflict (owner_id) do update
      set last_poll_at   = now(),
          worker_version = coalesce(excluded.worker_version, public.workers.worker_version);

  select * into job from public.jobs
    where status = 'queued' and owner_id = p_owner_id
    order by created_at
    for update skip locked
    limit 1;
  if not found then
    return null;
  end if;
  update public.jobs set status = 'running', claimed_at = now()
    where id = job.id
    returning * into job;
  return job;
end;
$$;
