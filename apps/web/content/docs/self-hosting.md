# Self-hosting

A team can run its own Markbase: one URL, the way a self-hosted Grafana is one
URL. The same build serves markbase.so and every instance. Any instance that is
not markbase.so is invite-only.

## What you need

- **A Supabase project you own.** Markbase uses Supabase's auth, realtime,
  storage and cron, so any Supabase works, on supabase.com or self-hosted. A
  bare Postgres does not.
- **Somewhere to run the server:** Docker on a machine of yours, or a Vercel
  account. See [Deploy on Vercel](/docs/deploy-on-vercel) for the second.

## 1. The database

Create the project, then apply the repository's migrations from a checkout:

```bash
npx supabase@2 db push --db-url "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
```

In the Supabase dashboard, under Authentication → URL Configuration, set the
**Site URL** to your instance's address and add `https://<your instance>/**` to
the **Redirect URLs**.

## 2. The server, with Docker

```bash
cp .env.example .env    # the project's URL and keys, APP_URL, an encryption key
docker compose up --build -d
```

The instance listens on port 3000. Put your usual reverse proxy with TLS in
front of it and set `APP_URL` to that address.

## 3. The first account

Open the instance right away and create the **admin** account on its set-up
page. Then invite your team; see [Invite your team](/docs/invite-your-team).

The full guide, with every variable, the scheduled jobs and troubleshooting, is
[SELF-HOSTING.md](https://github.com/Markbase-Team/Markbase/blob/main/SELF-HOSTING.md).
