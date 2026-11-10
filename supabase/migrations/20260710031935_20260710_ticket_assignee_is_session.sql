-- A ticket's agent assignee is a *named agent session*, not a raw API-key
-- connection. agent_session_id (added for ticket->session targeting) is now the
-- single assignee reference when owner_kind = 'agent'; owner_agent_id is retired
-- so the two can't drift.
--
-- Existing agent-owned tickets keep owner_kind='agent' with a null session (they
-- render as a generic "Agent" until reassigned) — a connection can't be mapped
-- to a session.
alter table public.tickets drop column if exists owner_agent_id;
