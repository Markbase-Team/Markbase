-- Per-agent access control: a capability ceiling on each API key (agent).
-- NULL = full owner (backward compatible). Effective capability on a doc =
-- min(capability, what the key's owner could do).
alter table public.api_keys
  add column if not exists capability text
  check (capability is null or capability in ('owner','editor','commenter','viewer'));

comment on column public.api_keys.capability is
  'Capability ceiling for this key/agent (owner>editor>commenter>viewer). NULL = full owner.';
