# Ticketing

A project request/ticketing app. Two surfaces:

- **Public** — outsiders submit and manage requests, scoped per project. Each
  project has its own route (`/projects/<slug>`). The first project is `cba`.
- **Admin** (`/admin`) — Markbase view of every ticket across all projects,
  with filters by project, status, and owner, plus inline status/owner control
  and project creation.

Built with Next.js (App Router) + shadcn/ui + Tailwind v4, backed by Supabase
Postgres.

## Pages

| Route | Who | Purpose |
| --- | --- | --- |
| `/` | anyone | Landing — lists projects, links to admin |
| `/projects/[project]` | public | Submit a request + view/edit/delete that project's requests |
| `/admin` | Markbase | All tickets, filters, set status/owner, add projects |

## Data model

`tickets`: `id`, `project`, `title`, `description`, `requester`, `owner`
(`markbase` \| `agent`), `status` (`requested` \| `ready_to_execute` \|
`in_progress` \| `need_review` \| `done`), `created_at`, `updated_at`.

`projects`: `slug`, `name`, `github_repo`, `created_at`.

In the request **description**, the requester is asked to include the resources
required to complete the task.

## API

Public, per-project (requesters):

- `GET    /api/projects/:project/tickets` — list project tickets
- `POST   /api/projects/:project/tickets` — create `{ title, requester, description }`
- `PATCH  /api/projects/:project/tickets/:id` — edit `{ title?, requester?, description? }`
- `DELETE /api/projects/:project/tickets/:id` — delete

Admin (Markbase, auth required):

- `GET    /api/v1/tickets?project=&status=&owner=` — list all, filterable
- `PATCH  /api/v1/tickets/:id` — update any field incl. `owner`, `status`
- `DELETE /api/v1/tickets/:id` — delete
- `POST   /api/v1/tickets/:id/dispatch` — start a Claude Code session (see below)
- `GET    /api/admin/projects` — list projects
- `POST   /api/admin/projects` — create `{ slug, name, source, repo }` where
  `source` is `local` (an absolute repo path) or `remote` (a github.com URL,
  cloned to `~/Desktop`); the resulting local path is stored

Agent callback (authenticated by the worker's API key; owner-scoped):

- `POST   /progress?ticket_id=…` (`Authorization: Bearer <api-key>`) — a running Claude Code session reports
  `{ commit_title, commit_link }` (appended) and `{ pr_title, pr_id, pr_link }`

## Claude Code assignee

Assigning a ticket to **Claude Code** and clicking *Send to Claude Code* runs a
headless Claude Code session (`claude -p`, permissions bypassed) with `cwd` set
to the project's local repo. The session is instructed to:

1. switch to the long-running `auto` branch,
2. implement the ticket as several small commits,
3. push and open a PR (`gh pr create`),
4. report each commit and the PR back to `/progress`.

The ticket then shows the commit links + PR link, and moves to `need_review`.
Requires the `claude` CLI, `gh` (authenticated), and a git remote for PRs. Runs
on a persistent server (`dev`/`start`), not serverless.

## Develop

```bash
npm run dev      # http://localhost:3000
npm run build
```

Environment (`.env.local`):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

## Access control

The `/dashboard` surface requires sign-in via **Supabase Auth** (email +
password). `src/proxy.ts` redirects signed-out visitors to `/login`.

Every API handler resolves its caller the same way — a browser session first,
then `Authorization: Bearer <api_key>` with the scope the route needs — so a
route never learns which credential was used. The one exception is
`/api/admin/api-keys`, which mints credentials and therefore accepts a session
only; a test pins that. The public `/projects/[project]` pages and their
endpoints stay open so outsiders can submit requests.

The admin user lives in Supabase's `auth.users` table. Create or reset admins
from the Supabase dashboard (Authentication → Users) or via SQL.

Note: the Supabase RLS policies on `tickets`/`projects` are still permissive —
gating is enforced at the Next.js layer. Tighten RLS to require an
authenticated role if you want defense in depth at the database.
