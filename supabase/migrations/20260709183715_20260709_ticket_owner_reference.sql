-- Ticket owners are now "the user themself or one of the agents they own",
-- replacing the fixed 2-value ticket_owner enum. owner_kind distinguishes the
-- two; owner_agent_id points at the api_keys row when an agent is assigned.
alter table public.tickets
  add column if not exists owner_kind text not null default 'user'
    check (owner_kind in ('user', 'agent')),
  add column if not exists owner_agent_id uuid
    references public.api_keys(id) on delete set null;

-- Backfill from the legacy enum: claude_code -> agent, everything else -> user.
update public.tickets
  set owner_kind = case when owner::text = 'claude_code' then 'agent' else 'user' end
  where owner is not null;

-- Drop the legacy enum column (superseded). The ticket_owner type is left in
-- place; it's simply unused now.
alter table public.tickets drop column if exists owner;
