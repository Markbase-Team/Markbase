-- A "version" in history = one editing session (open -> leave), not a time
-- bucket. Each save is tagged with the session it belongs to; history groups by
-- it. Client generates a session id per doc-open; server-initiated edits (agent
-- edits, restores) each get their own.
alter table docs.steps add column if not exists session_id text;
