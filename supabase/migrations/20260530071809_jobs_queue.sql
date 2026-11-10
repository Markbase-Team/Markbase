create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  kind text not null default 'dispatch',
  payload jsonb,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz
);

create index if not exists idx_jobs_status on public.jobs(status, created_at);

alter table public.jobs enable row level security;
drop policy if exists "public all jobs" on public.jobs;
create policy "public all jobs" on public.jobs
  for all using (true) with check (true);

-- Atomically claim the oldest queued job (safe for concurrent workers).
create or replace function public.claim_next_job()
returns public.jobs
language plpgsql
as $$
declare
  job public.jobs;
begin
  select * into job from public.jobs
    where status = 'queued'
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
$$;;
