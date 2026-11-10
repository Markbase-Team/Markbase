-- Does this user have Claude Code installed?
--
-- The right grain for the answer is the connection, not the user: Claude Code is
-- installed on a *machine*, and an api_key already represents one machine (it is
-- the capability boundary, for the same reason). A user "has Claude Code" when
-- any of their live connections reports a version.
--
-- Written twice, both from the machine itself: once by `markbase login`, which
-- probes `claude --version` before opening the browser, and then on every worker
-- repo sweep, so installing Claude Code after logging in still lights up.
alter table public.api_keys
  add column if not exists claude_version text;

comment on column public.api_keys.claude_version is
  'Version string from `claude --version` on the machine holding this key; null if Claude Code is absent or never probed.';

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
  );
