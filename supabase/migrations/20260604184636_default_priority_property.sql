-- Make "Priority" a default property on every project, like "status" is a
-- built-in field on every ticket. Most projects already have a hand-added
-- Priority (Low/Medium/High); this backfills the rest. New projects get it
-- seeded in code (createProject), so the two paths stay in sync.
--
-- Idempotent: only inserts where the project has no property named "priority"
-- (case-insensitive), so it won't violate project_properties_project_name_uniq
-- or duplicate the existing ones.
insert into public.project_properties (project, name, options, position)
select p.slug, 'Priority', array['Low', 'Medium', 'High'], 0
from public.projects p
where not exists (
  select 1
  from public.project_properties pp
  where pp.project = p.slug and lower(pp.name) = 'priority'
);
