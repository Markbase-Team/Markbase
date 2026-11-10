# Ticketing (monorepo)

A project request/ticketing system, split so the **web app can deploy to
Vercel** while **Claude Code execution stays on a local machine**.

```
apps/web/           Next.js app (public intake + admin board) → deploy to Vercel
apps/markbase/      Local CLI daemon (@markbase/cli): runs Claude Code, syncs a vault
apps/app/           Electron desktop app (@markbase/app): the same sync, native shell

Kernel — what everything else is built on:

packages/protocol/  @markbase/protocol — isomorphic: Supabase data layer, types,
                    pure logic. Runs in a browser, a server and a daemon alike.
packages/vault/     @markbase/vault — the local vault: watcher, lock, file sync.
                    The memory layer. It owns the container (which files exist,
                    what appears on disk), never what is inside them.
packages/server/    @markbase/node — server-only helpers
packages/runner/    @markbase/runner — job execution

Features — things you put IN the kernel:

packages/docs/      @markbase/docs — the collaborative-doc engine (CRDT,
                    markdown, schema, comments). Supplies what is inside a vault
                    file, through the vault's OpenSyncedFile seam.
packages/attention/ packages/email/       packages/flows/
packages/agent-chat/ packages/browser-agent/ packages/ui/
```

The vault is core and docs is a feature, so the arrow points from docs to the
vault, not the other way: the vault says what it needs from a synced file and
docs implements it. A second content type is a second implementation, not a
change to the vault.

Everything imports `@markbase/protocol`, so there's one source of truth for
types and the data layer (no duplication). It used to be `packages/core`, which
became protocol / node / vault / runner when it grew into a grab-bag and formed
an import cycle with `docs`. The graph is acyclic now, and
`packages/protocol/test/package-boundary.test.ts` fails if an edge is added
back — so it stays that way without anyone having to remember.

## How "run on local" works

The web app never runs `claude` itself. Instead:

1. Admin clicks **Run** → web sets the ticket `cc_state = 'queued'` and inserts a
   row in the **`jobs`** table (`POST /api/v1/tickets/:id/dispatch`).
2. The **worker** (running on your Mac) polls `claim_next_job()`, claims the job,
   and runs Claude Code against the project's `local_path`.
3. The worker writes results back to Supabase (commits, PR, preview, summary);
   the board polls and updates.

Your machine only makes **outbound** connections to Supabase — no tunnel, and
nothing on your laptop needs to be publicly reachable. Jobs queue while the
worker is off and drain when it starts.

## Develop

```bash
npm install            # at the repo root (npm workspaces)
npm run dev            # web app  → http://localhost:3000
```

Worker — the `markbase` CLI (`apps/markbase`):

```bash
cd apps/markbase && npm run build && npm link
markbase login           # browser auth → installs the background service
# or, foreground for debugging:  markbase start
```

Build / production:

```bash
npm run build          # builds apps/web
npm run start          # next start
```

### Env

`apps/web/.env.local`
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
APP_URL=...            # public URL where /progress lives (Vercel URL in prod)
CRON_SECRET=...        # auth for the daily classify-unread Vercel cron
```

The worker (`markbase`) needs no env file: `markbase login` saves your API key,
and everything the worker does goes through the web API with that key — it
holds no database credential at all (security lockdown stage 2). The progress
callback authenticates the same way and is owner-scoped (no shared token). A
self-hosted instance is one URL too: `markbase instance <url>` (or `markbase
login --app-url <url>`, or opening the instance's join link in the desktop
app) saves it, and `MARKBASE_APP_URL` overrides it for a dev server.

## Deploying

- **Web → your team's own instance,** on Vercel (project root `apps/web`,
  the same env as `.env.example`) or as one Docker container, with a Supabase
  project you own — see [SELF-HOSTING.md](./SELF-HOSTING.md). The first
  account created on it is the admin; after that it is invite-only: a member
  adds a teammate's address under Settings and sends them the join link,
  which points their desktop app at the instance and creates their account
  there (the terminal way in is `markbase login --app-url <your instance>`).
- **Worker → any machine:** `npm i -g @markbase/cli` (or `npm link`), then
  `markbase login`. Kept alive by the launchd/systemd service it installs.

## Status / not-yet-split

These features still execute in the web process (fine on `localhost`, but they
need worker routing before they work from a deployed Vercel app):

- **Chat follow-ups** (`/api/v1/tickets/:id/chat`) — still streams locally.
  Split plan: enqueue a `chat` job; worker resumes the session; UI polls
  `ticket_messages`.
- **"Get preview" button** and **project creation with clone / local-repo
  scanner** (`/api/v1/repos`, `/api/admin/projects`) — local-machine actions.
