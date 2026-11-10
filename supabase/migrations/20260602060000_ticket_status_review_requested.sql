-- Add a "review_requested" ticket status, set once a review has been requested
-- on the ticket's open PR (GitHub exposes this via reviewRequests/reviewDecision).
-- Slots in after need_review and before done. ADD VALUE IF NOT EXISTS is
-- idempotent and must run outside a transaction, so keep it in its own migration.
alter type public.ticket_status add value if not exists 'review_requested' after 'need_review';
