-- Phase 4: a ticket can target a specific named agent session (from the Agents
-- feature), not just an agent connection — so the work continues in that
-- session's thread/context. Nullable; cleared if the session row is removed.
alter table public.tickets
  add column if not exists agent_session_id uuid
    references public.agent_sessions(id) on delete set null;
