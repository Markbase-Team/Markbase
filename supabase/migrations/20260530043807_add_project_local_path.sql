alter table public.projects
  add column if not exists local_path text;

-- When this ran on the hosted database (2026-05-30) it also filled the column
-- for the one project that existed, with a path on its owner's machine; a
-- one-off for that database, not repeated here.
