-- The branch the Claude Code worker bases its work on and targets the PR
-- against. NULL means "the repo default" (treated as main by the app/prompt).
alter table public.tickets add column if not exists base_branch text;
