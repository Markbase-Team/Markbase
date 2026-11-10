-- Existing keys predate the probe, so they all read "no Claude Code" and would
-- lock current users out of Projects until they re-run `markbase login` with a
-- CLI new enough to report. Backfill from evidence we already have: a
-- worker_sessions row exists only because the worker read Claude Code's own
-- session files off that machine. The worker overwrites this with a real version
-- on its next sweep.
update public.api_keys k
set claude_version = 'pre-upgrade'
where k.claude_version is null
  and exists (
    select 1 from public.worker_sessions ws where ws.owner_id = k.owner_id
  );;
