-- Reads come from user_analytics_events.
--
-- "Read by agents" on a document was a tally kept inside the document's own
-- CRDT, added to from two places: the sync daemon (what agents' file hooks
-- saw) and the server (an agent reading through the API). Since
-- user_analytics_events records every agent call, an API read was written down
-- twice, in two shapes. The table is now the one record of a read: an API read
-- is a row as it happens, and a read an agent's hook saw is a row the sync
-- daemon reports (POST /api/v1/hook-events). The tally inside the document is
-- only read, for what older clients still put there.
--
-- This is the tally the panel shows, worked out from the rows: per account
-- and tool, how many reads and when the last one was. Every row is one event,
-- so counting is counting rows, with one exception kept from the old tally: an
-- agent reading through the API counts once a minute per account and tool,
-- because one that reads, edits and reads again within seconds has looked at
-- the document once. A key that names no tool (the desktop app reading for its
-- own window) is not an agent reading, and is left out, as before.
create function public.user_analytics_doc_reads(doc uuid)
returns table (owner_id uuid, provider text, client text, reads bigint, last_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select
    e.owner_id,
    e.provider,
    -- A hook's row names the agent in `client` ("claude", "codex", "cursor");
    -- an API read's `client` is the MCP client's own name, which varies, so
    -- API reads are grouped by the key's tool alone.
    case when e.action = 'hook.read' then e.client end as client,
    (
      count(*) filter (where e.action = 'hook.read')
      + count(distinct date_trunc('minute', e.created_at)) filter (where e.action = 'docs_readDoc')
    )::bigint as reads,
    max(e.created_at) as last_at
  from public.user_analytics_events e
  where e.doc_id = doc
    and e.actor_kind = 'agent'
    and e.outcome = 'success'
    and (
      e.action = 'hook.read'
      or (e.action = 'docs_readDoc' and e.provider is distinct from 'unknown')
    )
  group by e.owner_id, e.provider, case when e.action = 'hook.read' then e.client end
$$;

revoke all on function public.user_analytics_doc_reads(uuid) from public, anon, authenticated;
grant execute on function public.user_analytics_doc_reads(uuid) to service_role;
