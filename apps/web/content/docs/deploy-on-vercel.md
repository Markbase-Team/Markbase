# Deploy on Vercel

The hosted app runs on Vercel, so it is the best-trodden way to run your own
instance. You still need your own Supabase project with the migrations applied;
see [Self-hosting](/docs/self-hosting) step 1.

## Steps

1. Import the repository into Vercel: **Add New → Project**, then your fork or
   copy of `Markbase-Team/Markbase`.
2. Set **Root Directory** to `apps/web`. Leave the framework and build command
   as Vercel detects them.
3. Add the environment variables: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
   `SECRETS_ENCRYPTION_KEY`, and `APP_URL` set to the project's address.
4. Deploy, then put that address into the Supabase project's Site URL and
   Redirect URLs.

## Differences from Docker

- The two `NEXT_PUBLIC_` values are compiled in at build time, so changing
  them means a redeploy, not a restart.
- Updating is a push: bring the repository's `main` into your fork and Vercel
  builds it. Apply new migrations before you push when `supabase/migrations`
  changed.
