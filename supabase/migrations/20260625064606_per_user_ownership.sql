-- Per-user ownership across the app. owner_id = auth.users.id. Each user sees
-- only their OWN data — symmetric, no admin god-view. RLS stays permissive
-- because the worker and the agent API talk to Supabase with the publishable
-- key (no user JWT); scoping is enforced in the API layer and in
-- claim_next_job. Supersedes the never-applied 20260615_multitenant_ownership.

-- 1. Ownership columns (idempotent). owner_id has no FK to auth.users — it's a
--    plain uuid set/validated in app code, so user deletion can't cascade-wipe
--    rows and the worker/agent paths don't need the auth schema.
alter table public.projects           add column if not exists owner_id uuid;
alter table public.tickets            add column if not exists owner_id uuid;
alter table public.jobs               add column if not exists owner_id uuid;
alter table public.work_logs          add column if not exists owner_id uuid;
alter table public.project_properties add column if not exists owner_id uuid;
alter table public.today_todos        add column if not exists owner_id uuid;
alter table public.learning_diaries   add column if not exists owner_id uuid;
alter table public.secrets            add column if not exists owner_id uuid;
alter table public.vault_secrets      add column if not exists owner_id uuid;
alter table public.skills             add column if not exists owner_id uuid;
alter table public.skills             add column if not exists visibility text not null default 'private';
alter table public.api_keys           add column if not exists owner_id uuid;
alter table public.api_keys           add column if not exists owner_email text;

-- 2. Backfill. When this ran on the hosted database (2026-06-25) it assigned
--    every existing row to the one account that existed; that was a one-off
--    for that database and is not repeated here. A fresh database has no rows
--    to assign, and whose they are is not something a migration should know.

-- Catalog skills every user can see/install.
update public.skills set visibility = 'public'
  where lower(name) in ('personal-skill-library', 'record-learning');

-- 3. Derive owner_id for child rows from their parent on insert, so the public
--    intake form, the worker, and the app can't forget to set it.
create or replace function public.set_owner_from_project() returns trigger
  language plpgsql as $$
begin
  if new.owner_id is null then
    select owner_id into new.owner_id from public.projects where slug = new.project;
  end if;
  return new;
end $$;

create or replace function public.set_owner_from_ticket() returns trigger
  language plpgsql as $$
begin
  if new.owner_id is null then
    select owner_id into new.owner_id from public.tickets where id = new.ticket_id;
  end if;
  return new;
end $$;

drop trigger if exists tickets_set_owner on public.tickets;
create trigger tickets_set_owner before insert on public.tickets
  for each row execute function public.set_owner_from_project();

drop trigger if exists work_logs_set_owner on public.work_logs;
create trigger work_logs_set_owner before insert on public.work_logs
  for each row execute function public.set_owner_from_project();

drop trigger if exists project_properties_set_owner on public.project_properties;
create trigger project_properties_set_owner before insert on public.project_properties
  for each row execute function public.set_owner_from_project();

drop trigger if exists jobs_set_owner on public.jobs;
create trigger jobs_set_owner before insert on public.jobs
  for each row execute function public.set_owner_from_ticket();

-- 4. Route jobs to the owning worker. Each worker resolves its owner_id from
--    its API key (server-side) and claims only that owner's jobs. Replaces the
--    unscoped no-arg claim — the worker MUST be updated to pass p_owner_id in
--    lockstep with this migration.
drop function if exists public.claim_next_job();
create or replace function public.claim_next_job(p_owner_id uuid)
  returns public.jobs
  language plpgsql
as $$
declare
  job public.jobs;
begin
  select * into job from public.jobs
    where status = 'queued' and owner_id = p_owner_id
    order by created_at
    for update skip locked
    limit 1;
  if not found then
    return null;
  end if;
  update public.jobs set status = 'running', claimed_at = now()
    where id = job.id
    returning * into job;
  return job;
end;
$$;

-- 5. Indexes for the owner-filtered hot paths.
create index if not exists projects_owner_idx           on public.projects (owner_id);
create index if not exists tickets_owner_idx            on public.tickets (owner_id);
create index if not exists jobs_owner_status_idx        on public.jobs (owner_id, status);
create index if not exists work_logs_owner_idx          on public.work_logs (owner_id);
create index if not exists project_properties_owner_idx on public.project_properties (owner_id);
create index if not exists today_todos_owner_day_idx    on public.today_todos (owner_id, day);
create index if not exists learning_diaries_owner_idx   on public.learning_diaries (owner_id);
create index if not exists secrets_owner_idx            on public.secrets (owner_id);
create index if not exists vault_secrets_owner_idx       on public.vault_secrets (owner_id);
create index if not exists skills_owner_idx             on public.skills (owner_id);
create index if not exists api_keys_owner_idx           on public.api_keys (owner_id);
