-- Per-user plan / entitlement. One row per auth user; default 'free'. Kept
-- minimal now (a plan flag) but designed to extend later — e.g. add
-- stripe_customer_id, stripe_subscription_id, status, current_period_end.
-- RLS stays permissive (the worker reads it with the publishable key); scoping
-- is by user_id at the API/worker layer, consistent with the rest of the app.
create table if not exists public.user_plans (
  user_id uuid primary key,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- When this ran on the hosted database (2026-06-27) it also set the one
-- existing account to 'pro'; a one-off for that database, not repeated here.
-- A plan is granted per deployment, not by a migration that knows a name.
