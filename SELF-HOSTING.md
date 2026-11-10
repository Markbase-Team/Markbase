# Self-hosting Markbase

One Markbase instance for a team, the way a self-hosted Grafana is one URL: an
admin runs the server and creates the first account, invites the team, and
every vault they mount syncs to the team's own database.

The short version:

1. A Supabase project of your own, with this repo's migrations applied.
2. The server — one container on your machine, or the web app on Vercel.
3. Open it: the first account is the admin's. Invite the rest from Settings.

What you need:

- **Somewhere to run the server:** Docker (with Compose) on a machine of
  yours, or a [Vercel](https://vercel.com) account — either is enough.
- **A Supabase project you own.** Markbase is not only Postgres tables — it
  uses Supabase's auth (sign-in, sessions, row-level security), realtime (live
  edits in the browser), storage (images and attachments) and `pg_cron`. Any
  Supabase works: a project on supabase.com (the free tier is enough for a
  team), or the [Supabase docker stack](https://supabase.com/docs/guides/self-hosting/docker)
  running next to Markbase on your own hardware. A bare Postgres does not.
- **Node.js** on the admin's machine, once, to apply the database migrations
  (`npx supabase` below). The server itself needs nothing else.

## 1. The database

Create the Supabase project, then apply this repo's migrations to it. From a
checkout of the repo:

```bash
npx supabase@2 db push --db-url "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
```

The `@2` matters: this repo targets the Supabase CLI 2 line, and CLI 3 (released
November 2026) renamed the connection flag to `--remote` and reads a different
`config.toml` layout, so `supabase@latest` fails before it reaches the
database.

The connection string is under **Project Settings → Database** (use the direct
connection, not the pooler, for migrations). For the docker stack it is the
`POSTGRES_*` values in its `.env`. The migrations create every schema, table,
policy, storage bucket and cron job the app needs; `scripts/verify-db-rebuild.sh`
is the check that they still build a database from nothing.

Then, in the Supabase dashboard (**Authentication → URL Configuration**):

- **Site URL**: your instance's URL, e.g. `https://markbase.example.com`.
- **Redirect URLs**: add `https://markbase.example.com/**`.

Email and password sign-in works as is. For **Continue with Google**, enable the
Google provider under **Authentication → Providers** with your own OAuth client.
Whether new accounts need to confirm their email is also yours to decide there.

> Do not run `supabase config push` against your project: it overwrites the
> project's auth configuration with this repo's local-development settings.

## 2. The server

Two ways. Both run the same web app against the project from section 1, and
both come up as a team instance: anything that is not markbase.so is one.

### Option A — Docker, on your own machine

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → publishable key |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → secret key. Server only. |
| `APP_URL` | The URL your team will use, e.g. `https://markbase.example.com` |
| `SECRETS_ENCRYPTION_KEY` | `openssl rand -base64 32` — generate once, back it up |

The rest of `.env.example` is optional and commented. One of it is worth
knowing before the first build: `MARKBASE_FEATURES` is the set of feature
packages the image ships, and the one value that goes into the build. Left
empty it is the released product, Documents. The other packages in
`packages/features` are in the repository but not released; name them to ship
them, or set `all`. Whatever a build ships, every signed-in user sees. Then:

```bash
docker compose up --build -d
```

The first build takes a few minutes (it compiles the app); later ones are
incremental. The instance listens on port 3000 (`MARKBASE_PORT` changes the host
port). Put your usual reverse proxy with TLS in front of it and point `APP_URL`
at that — the login flow and share links are built from it.

Everything in `.env` is read when the container starts, the Supabase project
included: editing `.env` and `docker compose up -d` is enough, and the same
image can be started for another instance with another `.env`. The one
exception is `MARKBASE_FEATURES`, which is compiled in — changing it means
`docker compose up --build -d` again.

Check it is up:

```bash
curl -s http://localhost:3000/api/v1/instance
```

That answers with the Supabase project the instance runs on. It is public and
it is how the clients find out where they are.

### Option B — Vercel

The hosted app runs this way, so it is the best-trodden path: a Next.js
project whose root is `apps/web`, built from the repository with the same
five values as the `.env` above, set as the project's environment variables.

1. Import the repository into Vercel (**Add New → Project**, pick your fork
   or copy of this repo). Set **Root Directory** to `apps/web` and leave the
   framework and build command as Vercel detects them.
2. Under **Environment Variables**, add `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
   `SECRETS_ENCRYPTION_KEY` (see the table above), and `APP_URL` set to the
   URL the project will have — `https://<project-name>.vercel.app`, or your
   own domain once you attach it. Optional ones (`MARKBASE_FEATURES`,
   `OPENROUTER_API_KEY`, …) are the same as in `.env.example`.
3. **Deploy.** Then go back to section 1 and put that URL into the Supabase
   project's **Site URL** and **Redirect URLs**.

Or in one click, once the repository is public:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMarkbase-Team%2FMarkbase&root-directory=apps%2Fweb&project-name=markbase&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,SUPABASE_SECRET_KEY,SECRETS_ENCRYPTION_KEY,APP_URL&envDescription=Your%20Supabase%20project%20(section%201)%20and%20this%20instance%27s%20URL%20(section%202)&envLink=https%3A%2F%2Fgithub.com%2FMarkbase-Team%2FMarkbase%2Fblob%2Fmain%2FSELF-HOSTING.md)

Two things differ from Docker. The two `NEXT_PUBLIC_` values are compiled in
at build time on Vercel, so changing them — or `MARKBASE_FEATURES` — means a
redeploy, not just a restart. And updating is a push: pull this repository's
`main` into your fork and Vercel builds it (`apps/web/vercel-ignore.sh` skips
pushes that touch nothing the web app uses). Run the migrations (section 1)
before the push when `supabase/migrations` changed.

### Scheduled jobs

On the hosted app, Vercel calls two cron routes. Nothing calls them on a
self-hosted instance unless you schedule it — on Vercel, add them to
`apps/web/vercel.json` under `crons`. They are optional:

- `GET /api/cron/sweep-vault-assets` — removes uploaded images no document
  references any more.
- `GET /api/cron/classify-unread` — the AI inbox triage (needs `OPENROUTER_API_KEY`).

Set `CRON_SECRET` in `.env` and call them with `Authorization: Bearer
<CRON_SECRET>` from cron on the host, say daily.

### Updating (Docker)

```bash
git pull
npx supabase@2 db push --db-url "..."        # when supabase/migrations changed
docker compose up --build -d
```

## 3. The team

### The admin account

A fresh instance has no accounts and nobody to invite one. Open it in a
browser right after the first start — `https://markbase.example.com` (`/login`
and `/join` lead to the same place) — and you get **Set up markbase.example.com**:
an email and a password, no invite needed. While the instance has no
accounts, that page is open to whoever reaches it, and the account it creates
is recorded as the instance's **admin**; Settings says so. Do it straight
after deploying, before sharing the URL. The moment the account exists the
page is gone: from then on, sign-up needs an invite.

(The server also prints an invite link to its log at start —
`docker compose logs web` shows `Invite link: …`. On an empty instance it
leads to the same set-up page; afterwards it is the link teammates use.)

Then turn public sign-up off in the Supabase project (**Authentication →
Sign In / Up → Allow new users to sign up**). Invited accounts are created
with the secret key and keep working; nothing else can create one. Existing
accounts still sign in, with Google too if you enabled it.

### Inviting teammates

Anyone signed in can invite, under **Settings → Invite your team** (the
account row at the bottom of the sidebar, in the browser and in the app).
Two steps, and nothing is mailed — Markbase has no mailer, and the link
travels however your team talks:

1. **Add** the teammate's address. That puts it on the instance's invite
   list; the list is shown there until each one has joined, and an address
   can be withdrawn with its **×**.
2. **Send them the join link** shown below it —
   `https://markbase.example.com/join?code=…`. The page creates an account
   only for an address on the list, so the link can go in any channel.
   **New link** rotates the code, so a link that leaked stops working; a
   bare `/join` has nothing to hand on.

### Pointing the desktop app and the CLI at the instance

What the teammate does with the link:

**Desktop app:** the join page has the download
([the repository's releases](https://github.com/Markbase-Team/Markbase/releases),
macOS, Apple silicon, unsigned: the first time, right-click the app and
choose Open) and an **Open in desktop app** button. The button hands the
app the instance's address and the invite code; the app confirms, signs
out of wherever it was, restarts on the team's instance and opens its
sign-up, where they create their account with the address you added and a
password of their own — no confirmation mail, the invite vouches for them.
From then on the app signs in there. The same build serves the hosted app
and every instance — nothing about yours is baked into it; **Settings**
says which one the app is on. Someone without the app creates the account
in the browser instead, from the link at the bottom of the page. (An Intel
Mac, or a build that matches a particular commit: see *Building the
desktop app* below.)

**Terminal** (once the account exists, from the join link or the browser):

```bash
npx @markbase/cli login --app-url https://markbase.example.com
```

This saves the instance, opens the browser to authorize the machine, and
installs the background sync service. From now on every `markbase` command
talks to the team's instance, and vaults mounted with `markbase vault mount`
sync there.

The two share one saved instance (`~/.markbaseConfig/config.json`): a desktop
app opened after `markbase login --app-url` is already on the team's instance,
and a CLI run after connecting in the app is too. The app reads it at launch,
so an app that was open while the terminal changed it has to be restarted.

To see or change which instance a machine talks to:

```bash
markbase instance
markbase instance https://markbase.example.com
```

The desktop app follows the same file: the join link of another instance moves
it, and so does `markbase instance <url>` before the next launch. Either way
the app signs out, because an API key belongs to one instance, and asks you to
sign in on the other side (`markbase login` is the CLI's way back in).

## Building the desktop app

The released DMG is the easy path and is built for Apple silicon. Build your
own for an Intel Mac, or to match the exact commit your instance runs. On a
Mac with Node.js 22 or later and the Xcode command-line tools, from a checkout
of the repo:

```bash
npm ci
```

npm 11 skips packages' install scripts unless they are approved, and Electron
fetches its runtime in an explicit step rather than a postinstall, so a plain
install leaves you without the native modules and the runtime:

```bash
npm approve-scripts --all esbuild node-pty sharp unrs-resolver msw && npm rebuild esbuild node-pty sharp
```

```bash
(cd node_modules/electron && node install.js)
```

Then build (three to six minutes):

```bash
cd apps/app && npm run dist
```

The DMG lands in `apps/app/release/`, built for the architecture of the Mac
that built it. It is unsigned, like the released one.

## Troubleshooting

**"This page isn't working" with HTTP ERROR 431.** The browser sent more
request headers than the server accepts, and that is almost always cookies.
Browsers keep cookies per hostname, not per port, so an instance you try out at
`localhost:<port>` on a developer machine receives every cookie that every other
app on `localhost` ever set, and a few sign-ins' worth of Supabase sessions adds
up fast. Clear the site's cookies (DevTools → Application → Clear site data) or
use a private window. The image starts Node with a 64 KB limit instead of its
16 KB default, so this takes a lot of baggage; an instance on its own hostname
never sees anyone else's cookies.

**"Unsupported provider: provider is not enabled" on Continue with Google.**
Your Supabase project has no Google provider. Enable it with your own OAuth
client (section 1), or sign in with email and password; the button says so and
is greyed out when the instance knows Google is off.

## How the pieces connect

```
team member's machine                         admin's machine / cloud
┌────────────────────────┐    API key          ┌──────────────────────┐
│ markbase CLI / app     │ ──────────────────▶ │ web (this container) │
│   vault daemon         │  https://<APP_URL>  │   Next.js app + API  │
│   ticket worker        │                     └──────────┬───────────┘
│   desktop window       │                                │ secret key
└───────────┬────────────┘                                ▼
            │ publishable key                   ┌──────────────────────┐
            └─────────────────────────────────▶ │ Supabase project     │
              live edits (browser and desktop   │  Postgres · Auth ·   │
              window only, over Realtime)       │  Realtime · Storage  │
                                                └──────────────────────┘
```

File sync, the ticket worker and every CLI command go through the API only;
the daemon holds an API key and never a database credential. The one thing
that reaches Supabase directly from a client is a document's live-edit channel
in the browser and in the desktop window, with the publishable key, under
row-level security. That is why `markbase instance` saves the project beside
the URL: the desktop app reads it from there.
