-- Who set the instance up: the first account created on it.
--
-- A self-hosted instance starts with no accounts, so its sign-up is open to
-- exactly one person — whoever reaches it first, which is the person who just
-- deployed it. That account is recorded here as the instance's admin, the way
-- Gitea's first user is. Nothing is gated on it yet beyond saying so in
-- Settings; it is the hook a later permission (who may invite, who may rotate
-- the link) hangs on. Same row and grants as the invite code: the API's alone.
alter table public.instance_settings add column admin_user_id uuid;
