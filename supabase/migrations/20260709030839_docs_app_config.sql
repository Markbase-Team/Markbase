-- Small key/value config for the docs feature. First use: welcome_doc_id — the
-- single shared welcome doc everyone is granted commenter access to.
create table if not exists docs.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
