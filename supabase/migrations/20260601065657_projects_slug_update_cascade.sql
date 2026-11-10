-- Allow renaming a project's slug. tickets.project references projects.slug;
-- the original FK was ON UPDATE NO ACTION, which blocks slug edits. Switch it
-- to ON UPDATE CASCADE so renaming a slug re-points its tickets automatically
-- (delete stays CASCADE).
alter table public.tickets drop constraint tickets_project_fkey;
alter table public.tickets
  add constraint tickets_project_fkey
  foreign key (project) references public.projects (slug)
  on update cascade on delete cascade;
