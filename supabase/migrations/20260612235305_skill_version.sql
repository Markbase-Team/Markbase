-- Skill versioning: a monotonically increasing version per skill, bumped
-- whenever the body changes (on publish or admin edit). Installed copies carry
-- this number in their SKILL.md frontmatter so an "outdated" check can compare
-- the local version against the library's.
alter table public.skills
  add column if not exists version integer not null default 1;
