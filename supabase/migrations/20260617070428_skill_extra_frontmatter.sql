-- Preserve non-standard SKILL.md frontmatter keys (e.g. a custom `references:`
-- list, `allowed-tools:`) that aren't one of the managed fields. name,
-- description, and version are reconstructed from columns; everything else in
-- the original frontmatter is stored verbatim here and re-emitted by
-- buildSkillMd so it survives a publish/install round-trip.
alter table public.skills
  add column if not exists extra_frontmatter text not null default '';
