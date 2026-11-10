-- Per-ticket "commit & PR" toggle for the Claude Code session. When true
-- (default, the existing behaviour), the agent commits after each change and
-- opens/updates a PR. When false, it makes changes but leaves them uncommitted
-- for review.
alter table public.tickets
  add column if not exists auto_commit boolean not null default true;
