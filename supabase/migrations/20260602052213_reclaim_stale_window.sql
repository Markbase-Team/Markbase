-- Widen the staleness window from 15 to 30 minutes. The worker now heartbeats
-- a running job/ticket every minute (bumping jobs.claimed_at and
-- tickets.cc_last_run), so reclaim_stale only fires for genuinely dead runs
-- (crashed worker / slept laptop). The wider window is a backstop in case a
-- heartbeat is briefly delayed.
create or replace function public.reclaim_stale()
returns void
language sql
as $function$
  -- Jobs claimed but never finished within the window.
  update public.jobs
    set status = 'error', error = 'timed out', finished_at = now()
    where status = 'running' and claimed_at < now() - interval '30 minutes';

  -- Tickets whose run hung (worker crashed / machine slept).
  update public.tickets
    set cc_state = 'error',
        cc_summary = 'Run timed out — the worker stopped or crashed. Click Run again to retry.'
    where cc_state = 'running' and cc_last_run < now() - interval '30 minutes';

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
$function$;
