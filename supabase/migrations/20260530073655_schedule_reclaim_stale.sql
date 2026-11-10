create extension if not exists pg_cron;

-- Run the staleness sweep every 2 minutes.
select cron.schedule(
  'reclaim-stale-tickets',
  '*/2 * * * *',
  $$select public.reclaim_stale()$$
);;
