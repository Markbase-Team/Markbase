---
name: markbase-dev-test
description: The local Markbase test environment — the local Supabase stack, a self-hosted instance container on port 3100, the dev server, and the installed desktop app — and how to put all of it back to a clean "fresh instance, fresh install" state before a test. Use before any end-to-end test of sign-up, invites, joining an instance, or the desktop app; whenever a test needs clean accounts; and when driving the installed app or a dev run over CDP.
---

# Markbase dev test environment

Everything a test touches lives on this machine, against the **local Supabase
stack** (`npx supabase@2 start` in the repo; its containers are
`supabase_db_<project>`, `supabase_auth_…`, Mailpit at
http://127.0.0.1:54324). Nothing here reaches production.

| Piece | Where | Notes |
| --- | --- | --- |
| Self-hosted instance | http://localhost:3100 (`docker compose up --build -d` from a worktree; container `<worktree>-web-1`) | Built from the worktree's code. `.env` has `APP_URL=http://localhost:3100`, `MARKBASE_PORT=3100`, and the local stack's keys. Rebuild after code changes. |
| Dev server | http://localhost:3002 (`.claude/launch.json` → `web-local-supabase`) | Same local stack, same database as 3100. Hot reload. |
| Desktop app | `/Applications/Markbase.app`; log at `~/Library/Application Support/@markbase/app/vault.log`; settings at `…/@markbase/app/settings.json`; instance + mounts at `~/.markbaseConfig/config.json` | A DMG: `cd apps/app && npm run dist` → `apps/app/release/`. Install by swapping the `.app` (quit first, `codesign --force --deep --sign -`, `lsregister -f`). |
| Dev run of the app | `cd apps/app && npm run build && MARKBASE_HOME=<scratch>/mbhome MARKBASE_USER_DATA=<scratch>/udata npx electron . --remote-debugging-port=9333` | Its own registry and settings under the scratch folders, so the installed app is untouched. |

Every instance and the dev server share **one database**, so accounts, invites
and documents made on one show on the others, and so does a reset.

## Clean state

Two scripts, both refuse to run without `--yes`:

```bash
.claude/skills/markbase-dev-test/scripts/reset-local-stack.sh --yes
```

Resets the local database from `supabase/migrations` (no seed), restores the
grants the API's role loses on a local reset, restarts every instance
container, and prints each one's fresh invite link. After it the instance has
**no accounts**: the first account is created from that link (the link alone
admits until an account exists), and every account after that must be added
under Settings → Invite your team first. Tell sibling sessions before running
it; the database is theirs too.

```bash
.claude/skills/markbase-dev-test/scripts/reset-desktop-app.sh --yes
```

Quits the installed app, points the machine back at https://markbase.so and
signs the app out — what a fresh install looks like. Mounted vaults and their
folders are not touched. Never run it while a sign-in is in flight (the log's
tail says).

## Test accounts

- Addresses: `<scenario>-<date>@example.com` (for example
  `first-1106@example.com`, `invited-1106@example.com`). Nothing real.
- Passwords go in a scratchpad file, never in a reply; the local stack has no
  mail, so there is nothing to confirm.
- Who exists right now:
  `docker exec supabase_db_<project> psql -U postgres -d postgres -At -c "select email from auth.users order by created_at;"`
  and the invite list: `select email, accepted_at is not null as joined from public.instance_invites;`

## Driving things

- **Browser pane**: cookies are per hostname, not per port, so a session on
  3002 is a session on 3100. Use a private window for "new person" steps, or
  clear the site's cookies.
- **Installed app over CDP**: launch with
  `open -a Markbase --args --remote-debugging-port=9222`, then
  `curl 127.0.0.1:9222/json` lists its pages; a page whose URL starts with
  `markbase://app` is the dashboard, one on `http://localhost:3100/…` is the
  instance's sign-in or sign-up inside the window. `Runtime.evaluate` fills
  forms and clicks; `Page.captureScreenshot` proves what was on screen. Native
  dialogs (folder picker, "Join …?" confirm) cannot be driven — say so.
- **A join link against the installed app**:
  `open "markbase://connect?instance=http%3A%2F%2Flocalhost%3A3100&code=<code>"`.
  On an instance the app is already on, signed out, it goes straight to the
  sign-up; otherwise the native confirm appears first.
- **Instance log**: `docker logs <worktree>-web-1 2>&1 | grep 'Invite link'`.
- **API checks without a browser**: `POST /api/v1/instance/join` with
  `{code,email,password}` (public), `GET /api/v1/instance/invite` (needs a
  session or key; 401 proves the gate).

## Gotchas

- A fresh local reset leaves `service_role` without grants on `public.*`
  (42501 from the API); the reset script restores them.
- The local auth config allows redirects only to `http://127.0.0.1:3000`, so
  anything that relies on a Supabase redirect (OAuth, mail links) lands there,
  not on 3100 or 3002.
- The invite code is the instance's, in `public.instance_settings`; rotating
  it under Settings → New link invalidates every link already sent.
- Vault mounts are machine-scoped: a different account signed into the app
  only syncs its own mounts; the others stay in the registry and are left
  alone. Do not delete them to "clean" anything.
