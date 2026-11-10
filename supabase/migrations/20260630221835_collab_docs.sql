-- Collaborative docs (PM-canonical, operation-based editing) live in their own
-- `docs` schema, separate from the app's public tables. Canonical state is the
-- ProseMirror document (doc_json); markdown (content) is an always-current
-- export; every edit is a step in an append-only log; comments anchor to
-- positions; multiple humans + agents collaborate, gated by capability.
--
-- NOTE: a custom schema is NOT auto-exposed to the API. After this migration,
-- add `docs` to Project Settings -> API -> Exposed schemas in the dashboard, or
-- the REST/JS client (and realtime) can't see these tables.

create schema if not exists docs;
grant usage on schema docs to anon, authenticated, service_role;

-- A standalone document, owned by its creator. Projects reference it via the
-- mapping table below (a doc is not tied to one project).
create table docs.documents (
  id         uuid primary key default gen_random_uuid(),
  title      text not null default 'Untitled',
  doc_json   jsonb not null,                 -- canonical ProseMirror document
  content    text not null default '',       -- markdown export, kept current
  version    integer not null default 0,     -- = number of applied steps
  owner_id   uuid not null,                  -- creator; manages members/links, can delete
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Authenticated collaborators and their capability on a doc. Owner is implicit
-- (documents.owner_id) and not duplicated here.
create table docs.members (
  id         uuid primary key default gen_random_uuid(),
  doc_id     uuid not null references docs.documents(id) on delete cascade,
  user_id    uuid not null,
  capability text not null check (capability in ('editor','commenter','viewer')),
  invited_by uuid,
  created_at timestamptz not null default now(),
  unique (doc_id, user_id)
);

-- Shareable links. `member` links require sign-in and create a members grant on
-- first open; `guest` links open the anonymous review surface (comment/suggest).
create table docs.links (
  id         uuid primary key default gen_random_uuid(),
  doc_id     uuid not null references docs.documents(id) on delete cascade,
  token      text not null unique,
  mode       text not null check (mode in ('member','guest')),
  capability text not null check (capability in ('editor','commenter','viewer')),
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Project <-> doc mapping (M:N). A project ties to docs through here.
create table docs.projects (
  id         uuid primary key default gen_random_uuid(),
  doc_id     uuid not null references docs.documents(id) on delete cascade,
  project    text not null references public.projects(slug) on update cascade on delete cascade,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  unique (doc_id, project)
);

-- The op log / history: one row per applied step, ordered by version.
create table docs.steps (
  id          uuid primary key default gen_random_uuid(),
  doc_id      uuid not null references docs.documents(id) on delete cascade,
  version     integer not null,              -- the version this step produced
  step        jsonb not null,
  author_kind text not null,                 -- 'user' | 'agent' | 'guest'
  author_id   uuid,
  author_name text not null default '',
  created_at  timestamptz not null default now(),
  unique (doc_id, version)
);

-- Anchored review comments. Positions are remapped through steps on each edit;
-- quoted_text is the fallback when an anchor goes outdated.
create table docs.comments (
  id             uuid primary key default gen_random_uuid(),
  doc_id         uuid not null references docs.documents(id) on delete cascade,
  anchor_from    integer not null,
  anchor_to      integer not null,
  anchor_version integer not null,
  quoted_text    text not null default '',
  body           text not null,
  author_kind    text not null,
  author_id      uuid,
  author_name    text not null default '',
  resolved       boolean not null default false,
  suggestion_id  uuid,
  parent_id      uuid references docs.comments(id) on delete cascade,
  created_at     timestamptz not null default now()
);

-- Proposed edits (Google-Docs "suggesting"): steps held pending owner accept.
create table docs.suggestions (
  id           uuid primary key default gen_random_uuid(),
  doc_id       uuid not null references docs.documents(id) on delete cascade,
  base_version integer not null,
  steps        jsonb not null,
  author_kind  text not null,
  author_id    uuid,
  author_name  text not null default '',
  status       text not null default 'pending' check (status in ('pending','accepted','rejected')),
  comment_id   uuid references docs.comments(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index documents_owner_idx   on docs.documents (owner_id);
create index members_doc_idx       on docs.members (doc_id);
create index members_user_idx      on docs.members (user_id);
create index links_doc_idx         on docs.links (doc_id);
create index doc_projects_doc_idx  on docs.projects (doc_id);
create index doc_projects_proj_idx on docs.projects (project);
create index steps_doc_idx         on docs.steps (doc_id, version);
create index comments_doc_idx      on docs.comments (doc_id);
create index suggestions_doc_idx   on docs.suggestions (doc_id, status);

-- RLS permissive (scoping/authorization enforced in the API, matching the app's
-- existing posture). Multi-user privacy of realtime is a later hardening.
alter table docs.documents   enable row level security;
alter table docs.members     enable row level security;
alter table docs.links       enable row level security;
alter table docs.projects    enable row level security;
alter table docs.steps       enable row level security;
alter table docs.comments    enable row level security;
alter table docs.suggestions enable row level security;

create policy "permissive" on docs.documents   for all using (true) with check (true);
create policy "permissive" on docs.members     for all using (true) with check (true);
create policy "permissive" on docs.links       for all using (true) with check (true);
create policy "permissive" on docs.projects    for all using (true) with check (true);
create policy "permissive" on docs.steps       for all using (true) with check (true);
create policy "permissive" on docs.comments    for all using (true) with check (true);
create policy "permissive" on docs.suggestions for all using (true) with check (true);

grant all on all tables in schema docs to anon, authenticated, service_role;
alter default privileges in schema docs grant all on tables to anon, authenticated, service_role;

-- Realtime for the live surfaces (steps stream edits; comments/suggestions stream review).
alter publication supabase_realtime add table docs.steps;
alter publication supabase_realtime add table docs.comments;
alter publication supabase_realtime add table docs.suggestions;
