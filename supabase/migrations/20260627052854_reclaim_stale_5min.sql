-- Tighten the staleness window from 30 to 5 minutes. The worker heartbeats the
-- running job/ticket every 60s, so 5 missed heartbeats unambiguously means the
-- run is dead (worker crashed, slept, or was restarted mid-run). Faster reclaim
-- means an orphaned run stops falsely showing "running"/"Working…" within
-- minutes instead of half an hour.
create or replace function public.reclaim_stale()
returns void
language sql
as $function$
  update public.jobs
    set status = 'error', error = 'timed out', finished_at = now()
    where status = 'running' and claimed_at < now() - interval '5 minutes';

  update public.tickets
    set cc_state = 'error',
        cc_summary = 'Run interrupted — the worker stopped, slept, or restarted. Click Run again to retry.'
    where cc_state = 'running' and cc_last_run < now() - interval '5 minutes';

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
