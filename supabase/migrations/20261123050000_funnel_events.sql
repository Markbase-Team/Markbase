-- product_events becomes funnel_events, and every event says where it happened.
--
-- The table only ever held what funnels read: moments in the product only we
-- care about (a modal shown, an account signed up). What people and agents do
-- to their own data is user_analytics_events, which the customer can see. The
-- new name says which of the two this is.
--
-- An event is an action and a source, kept apart: `account.sign_in` from the
-- desktop app and from the CLI is one action in two places, so a funnel can
-- count it once or split it by where (packages/shared/src/analytics/funnel/).
-- The sources are a closed list: web, desktop, cli, mcp (an AI app reaching
-- Markbase through a connector).
--
-- No row is rewritten: an event recorded before this came from the web app,
-- which is where the only events there were came from.
alter table public.product_events rename to funnel_events;
alter index public.product_events_user_created rename to funnel_events_user_created;
alter index public.product_events_name_created rename to funnel_events_name_created;
alter table public.funnel_events rename constraint product_events_pkey to funnel_events_pkey;
alter sequence public.product_events_id_seq rename to funnel_events_id_seq;

alter table public.funnel_events
  add column source text not null default 'web' check (source in ('web', 'desktop', 'cli', 'mcp'));
alter table public.funnel_events alter column source drop default;
