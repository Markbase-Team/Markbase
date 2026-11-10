-- Rename the "agent" assignee to "claude_code"
alter type ticket_owner rename value 'agent' to 'claude_code';

-- Track the Claude Code session dispatched for a ticket
alter table public.tickets
  add column if not exists cc_state text not null default 'idle',
  add column if not exists cc_session_id text,
  add column if not exists cc_summary text,
  add column if not exists cc_last_run timestamptz;;
