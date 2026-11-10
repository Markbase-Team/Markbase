-- Realtime: stream ticket row changes to the admin board (replaces polling).
alter publication supabase_realtime add table public.tickets;

-- Staleness guard: reset orphaned runs so nothing shows "running" forever.
create or replace function public.reclaim_stale()
returns void
language sql
as $$
  -- Jobs claimed but never finished within the window.
  update public.jobs
    set status = 'error', error = 'timed out', finished_at = now()
    where status = 'running' and claimed_at < now() - interval '15 minutes';

  -- Tickets whose run hung (worker crashed / machine slept).
  update public.tickets
    set cc_state = 'error',
        cc_summary = 'Run timed out — the worker stopped or crashed. Click Run again to retry.'
    where cc_state = 'running' and cc_last_run < now() - interval '15 minutes';

  -- Tickets queued but with no live job (queue entry lost).
  update public.tickets t
    set cc_state = 'error',
        cc_summary = 'Queue entry was lost. Click Run again to retry.'
    where t.cc_state = 'queued'
      and t.cc_last_run < now() - interval '10 minutes'
      and not exists (
        select 1 from public.jobs j
        where j.ticket_id = t.id and j.status in ('queued', 'running')
      );
$$;;
