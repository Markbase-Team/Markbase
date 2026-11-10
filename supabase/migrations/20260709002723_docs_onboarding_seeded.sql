-- One row per user once their welcome doc has been seeded. Its presence (not the
-- doc itself) is the gate, so deleting the welcome doc never re-seeds it.
create table if not exists docs.onboarding_seeded (
  user_id uuid primary key,
  seeded_at timestamptz not null default now()
);
