-- Make the column safe for code that predates it.
--
-- confirmed_at was added with no default, so any caller that doesn't mention it
-- inserts NULL — which now means "inert, sweep me". The deployed web app is
-- exactly such a caller: the migration reached the database before the code that
-- sets the column reached production, so every key minted in between would have
-- gone live-looking and then vanished half an hour later.
--
-- Defaulting to now() inverts that: a caller that says nothing gets the old
-- behaviour (a working key), and only a caller that explicitly passes NULL --
-- createApiKey with requiresConfirmation -- opts into mint-after-confirm. An
-- explicit NULL still wins over a default, so the new path is unaffected.
alter table public.api_keys
  alter column confirmed_at set default now();;
