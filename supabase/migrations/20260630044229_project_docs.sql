-- Per-project documentation: editable markdown docs scoped to a project (and its
-- owner), mirroring work_logs. Replaces the old global static /dashboard/docs.

create table if not exists public.project_docs (
  id         uuid primary key default gen_random_uuid(),
  project    text not null references public.projects(slug) on update cascade on delete cascade,
  title      text not null default '',
  content    text not null default '',
  position   integer not null default 0,
  owner_id   uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_docs_project_idx on public.project_docs (project);
create index if not exists project_docs_owner_idx on public.project_docs (owner_id);

alter table public.project_docs enable row level security;
drop policy if exists "public all project_docs" on public.project_docs;
create policy "public all project_docs" on public.project_docs
  for all using (true) with check (true);

-- Auto-populate owner_id from the project's owner (same helper as work_logs).
drop trigger if exists project_docs_set_owner on public.project_docs;
create trigger project_docs_set_owner before insert on public.project_docs
  for each row execute function public.set_owner_from_project();

-- Migrate the existing static "Worker management" doc into the jessie-s project
-- (guarded: only when that project exists and the doc isn't already there). The
-- content lived at apps/web/src/docs/worker-management.md before this change.
insert into public.project_docs (project, title, content)
select 'jessie-s', 'Worker management', $doc$# Worker management

The **worker** is a small program that runs on your own machine. It's what
actually runs Claude Code on your local repos. The web app (on Vercel) only
**enqueues** jobs; the worker **claims and executes** them — scoped to your
account, so it only ever runs *your* tickets.

> **If your worker isn't running, your tickets sit in `queued` forever.** That's
> the #1 cause of "it's stuck queueing."

It ships as a CLI, **`jessie`** (the `@markbase/cli` package). Anyone with an
account can install it and run their own worker on their own machine.

## Install & set up

```bash
npm i -g @markbase/cli     # or: npx @markbase/cli init
jessie init                  # asks for your API key, verifies it, then installs
                             # + starts the background service automatically
```

`jessie init` resolves your `owner_id` from the API key (via `/api/v1/me`), so
the worker only claims your jobs. Create the API key in the dashboard under
**API keys**.

## Prerequisites

`jessie doctor` checks these and prints the exact fix for anything missing:

- **`claude`** — Claude Code, installed and logged in (runs the sessions).
- **`git`** + **`gh`** (GitHub CLI, `gh auth login`) — for branches, commits, PRs.
- A reachable app URL and a valid **API key**.

Each project you want the worker to act on must be cloned locally; its
`local_path` (set in the dashboard) points at that clone.

## How it runs

`jessie install-service` registers a background service so it:

- starts automatically at login,
- restarts itself if it crashes,
- writes logs to `~/Library/Logs/jessie.log` (macOS, launchd) or the journal
  (Linux, systemd).

It **polls every 3 seconds** when idle — one tiny Supabase query
(`claim_next_job`) each time; idle cost is negligible. Real work only happens
while a ticket is running (spawning `claude`, git, builds).

## Everyday commands

```bash
jessie doctor              # check prerequisites + that your key resolves
jessie start               # run in the foreground (debugging; Ctrl-C to stop)
jessie install-service     # install + start the background service
jessie uninstall-service   # stop + remove it
tail -f ~/Library/Logs/jessie.log   # watch logs (macOS)
```

After upgrading the package (`npm i -g @markbase/cli@latest`), restart the
service so the new code is picked up: `jessie uninstall-service && jessie install-service`.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Ticket stuck in **Queued** | Your worker isn't running | `jessie doctor`, then `jessie install-service` (or `jessie start`) |
| `claim error` in logs | App not deployed / key invalid | `jessie doctor` — check the API key resolves |
| Ticket stuck in **Running** | A run crashed or the machine slept | The staleness sweep resets runs idle > 30 min; or **Run again** |
| `jessie: command not found` | Not installed / not on PATH | `npm i -g @markbase/cli` |

## Notes

- The worker authenticates with **your API key**, and the progress callback is
  owner-scoped — a worker can only read/update its own owner's tickets.
- It uses the Supabase **publishable** key (RLS is permissive; scoping is
  enforced in the API and `claim_next_job`).
- One job runs at a time, so two sessions never fight over the `auto` branch.
$doc$
where exists (select 1 from public.projects where slug = 'jessie-s')
  and not exists (
    select 1 from public.project_docs where project = 'jessie-s' and title = 'Worker management'
  );
