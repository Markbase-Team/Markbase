-- A property can have a default value: when a ticket is created, any property
-- with a non-empty default_value is pre-filled with it (unless a value was
-- supplied). Empty string = no default.
alter table public.project_properties
  add column if not exists default_value text not null default '';

-- Seed the requested default: the "Type" property defaults to "Execution".
update public.project_properties
  set default_value = 'Execution'
  where name = 'Type' and 'Execution' = any(options) and default_value = '';
