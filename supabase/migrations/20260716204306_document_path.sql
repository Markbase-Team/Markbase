-- A document's vault-relative path, e.g. "projects/2026/q1.md".
--
-- The vault's folder structure lives in the path itself (the way Obsidian, git
-- and iCloud all work). Without a stored path, every document resolves to a
-- sanitized title at the vault root, so a folder structure could never come down
-- from the cloud — and a file adopted inside a folder would be yanked back to the
-- root on the next sync.
--
-- Nullable: documents created before paths existed fall back to their title.
alter table docs.documents add column if not exists path text;
