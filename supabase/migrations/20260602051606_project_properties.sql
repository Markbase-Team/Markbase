-- Project properties: admin-defined property/value pairs attached to a project.
--
-- An admin defines a property on a project (a named field, optionally with a
-- fixed set of allowed values). Every ticket in that project then "has" the
-- property, though its value may be unset. Admins can sort the board by any
-- property and filter by a property's value.
--
-- The definitions live in `project_properties` (one row per property per
-- project). The per-ticket values live in a `properties` JSONB map on the
-- ticket, keyed by property id → value string. Keying by id (not name) means a
-- property can be renamed without rewriting every ticket.
--
-- RLS mirrors `projects`/`tickets`: enabled with a permissive public policy, so
-- the web app's publishable key (used server-side behind the admin auth gate)
-- can read and write. Access control is enforced at the API layer.

create table if not exists public.project_properties (
  id         uuid primary key default gen_random_uuid(),
  project    text not null references public.projects(slug)
               on update cascade on delete cascade,
  name       text not null,
  -- Optional fixed set of allowed values. Empty => the value is free text.
  options    text[] not null default '{}',
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists project_properties_project_idx
  on public.project_properties (project);

-- One property name per project (case-insensitive).
create unique index if not exists project_properties_project_name_uniq
  on public.project_properties (project, lower(name));

alter table public.project_properties enable row level security;

drop policy if exists "public all project_properties" on public.project_properties;
create policy "public all project_properties"
  on public.project_properties for all
  using (true) with check (true);

-- Per-ticket property values: { "<property_id>": "<value>" }.
alter table public.tickets
  add column if not exists properties jsonb not null default '{}'::jsonb;
