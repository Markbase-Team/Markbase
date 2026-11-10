-- Project owners: the names of the people who own a project. Admin-managed,
-- free text (not tied to app users), stored as an ordered list of names.
-- Mirrors how `project_properties.options` is a plain text[] — the web app's
-- publishable key writes it server-side behind the admin auth gate.

alter table public.projects
  add column if not exists owners text[] not null default '{}';
