-- Merge the "need_review" status into "review_requested": move every ticket
-- currently in need_review, then drop the value from the ticket_status enum so
-- there's a single review status going forward.
--
-- Postgres can't DROP an enum value in place, so recreate the type. Safe to run
-- in a transaction (unlike ADD VALUE). Only tickets.status uses ticket_status.

-- 1. Move the tickets first, so no row holds the value we're about to remove.
update public.tickets
  set status = 'review_requested'
  where status = 'need_review';

-- 2. Recreate the enum without need_review.
alter table public.tickets alter column status drop default;

alter type public.ticket_status rename to ticket_status_old;

create type public.ticket_status as enum (
  'requested',
  'ready_to_execute',
  'in_progress',
  'review_requested',
  'done'
);

alter table public.tickets
  alter column status type public.ticket_status
  using status::text::public.ticket_status;

alter table public.tickets
  alter column status set default 'requested'::public.ticket_status;

drop type public.ticket_status_old;
