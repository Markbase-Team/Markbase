-- Security lockdown, stage 2: a document's live state.
--
-- Stage 1 (20260916162448) closed every table the public key never needed and
-- left docs.doc_crdt open on purpose: the browser, the desktop app and the vault
-- daemon all read and wrote CRDT snapshots there with the publishable key, and
-- relayed live edits over public `crdt:<docId>` broadcast channels. Anyone
-- holding that key and a document id could therefore overwrite any document's
-- content, or read every keystroke made in it, and the owner's daemon would
-- write the result to disk as if it were legitimate.
--
-- From here on the web API is the only writer and the only reader of
-- docs.doc_crdt. It checks the caller's capability on the document the way every
-- other document endpoint does (viewer to read, editor to write, an API key's
-- ceiling applied) and talks to this table with the secret key, which bypasses
-- the grants and policies below. Live edits between browsers travel on PRIVATE
-- Realtime channels, `doc:<docId>`, authorized by the policies in section 3 from
-- the signed-in user's own row in docs.documents / docs.members. The daemons and
-- the desktop app, which hold an API key and no database credential, no longer
-- touch Realtime at all: they save through the API and poll it for changes.
--
-- This migration is ADDITIVE and safe to apply before any client has updated.
-- The old access stays available behind one switch, docs.app_config
-- 'crdt_public_access', so the cutover is a single row update once every daemon
-- is on a version that uses the API -- and a single row update back if one is
-- not. The follow-up that removes the switch revokes the grants outright.

-- ---------------------------------------------------------------------------
-- 1. A version on every snapshot.
--
-- A snapshot save used to be last-write-wins at the row level: whichever client
-- upserted last won, and a snapshot that did not yet contain another client's
-- edits silently dropped them from the stored copy. The server now MERGES the
-- incoming state into the stored one (Yjs makes that lossless) and writes the
-- result with a compare-and-swap on this column, retrying when it lost a race.
-- Pollers use it to skip snapshots they already hold.
-- ---------------------------------------------------------------------------
alter table docs.doc_crdt add column if not exists version bigint not null default 0;

-- The changes feed below asks "what moved since <time>"; without this it walks
-- every snapshot on every poll.
create index if not exists doc_crdt_updated_at_idx on docs.doc_crdt (updated_at);

-- ---------------------------------------------------------------------------
-- 2. The caller's capability on a live channel's document.
--
-- The same rule as capabilityFor() in packages/features/docs/src/server/auth.ts:
-- the owner is the owner; otherwise the member grant; otherwise nothing. A share
-- link guest never reaches here -- guests have no session, so no JWT, so no
-- private channel; they go through the API like a daemon does.
--
-- SECURITY DEFINER because the roles that evaluate it (anon, authenticated) have
-- no SELECT on docs.documents or docs.members since stage 1, and a policy
-- expression runs as the calling role. The function reads only what the policy
-- needs and returns a word, never a row.
-- ---------------------------------------------------------------------------
create or replace function docs.crdt_topic_doc(topic text)
returns uuid
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when topic ~ '^doc:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substr(topic, 5)::uuid
    else null
  end;
$$;
revoke execute on function docs.crdt_topic_doc(text) from public, anon, authenticated;

create or replace function docs.crdt_topic_capability(topic text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select case
    when d.owner_id = auth.uid() then 'owner'
    else m.capability
  end
  from docs.documents d
  left join docs.members m on m.doc_id = d.id and m.user_id = auth.uid()
  where d.id = docs.crdt_topic_doc(topic)
    and d.deleted_at is null;
$$;
-- Callable by the signed-in role, because Realtime evaluates the policies below
-- as that role. Nobody anonymous: a JWT-less socket is nobody on a private
-- channel. supabase/tests/security_lockdown.test.sql lists it as the one
-- function `authenticated` may call, and says why.
revoke execute on function docs.crdt_topic_capability(text) from public, anon;
grant execute on function docs.crdt_topic_capability(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Private Realtime channels for live edits.
--
-- realtime.messages has RLS on and, until now, no policies: every private
-- channel was deny-all. A client joining `doc:<docId>` with `private: true` is
-- checked against these at join time -- SELECT to receive, INSERT to send. The
-- server publishes with the secret key, which these never see.
--
-- `extension = 'broadcast'`: presence is not used on these channels, and a
-- policy that says so costs nothing.
-- ---------------------------------------------------------------------------
drop policy if exists "doc channel: members receive" on realtime.messages;
create policy "doc channel: members receive" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and docs.crdt_topic_capability(realtime.topic()) is not null
  );

drop policy if exists "doc channel: editors send" on realtime.messages;
create policy "doc channel: editors send" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and docs.crdt_topic_capability(realtime.topic()) in ('owner', 'editor')
  );

-- ---------------------------------------------------------------------------
-- 4. The changes feed the daemons poll.
--
-- "Which of the documents this user can see have a newer snapshot than the one
-- it last asked about" -- one query per folder per poll, served by the API with
-- the secret key. Trashed documents are not reported. Capped so a vault that
-- moved a thousand files at once is paged rather than dumped: the API's cursor
-- is the last updated_at it returned, so the next poll continues.
--
-- Two ways to scope it, matching the two folders a daemon can hold:
--   p_vault   -- one of the user's own vaults. A document shared with the user
--                lives in its OWNER's vault, so it never appears here, exactly
--                as listDocumentsForUser leaves it out of a vault-scoped list.
--   p_shared  -- the user's Shared Vault: documents they are a member of but
--                do not own, whichever vault those sit in. p_vault is ignored.
-- Neither (the desktop window, which shows everything) -- owned and shared.
-- ---------------------------------------------------------------------------
create or replace function docs.crdt_changes(
  p_user uuid,
  p_since timestamptz,
  p_vault uuid default null,
  p_shared boolean default false
)
returns table (doc_id uuid, version bigint, updated_at timestamptz)
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select c.doc_id, c.version, c.updated_at
  from docs.doc_crdt c
  join docs.documents d on d.id = c.doc_id
  where c.updated_at > p_since
    and d.deleted_at is null
    and case
      when p_shared then
        d.owner_id <> p_user
        and exists (select 1 from docs.members m where m.doc_id = d.id and m.user_id = p_user)
      else
        (p_vault is null or d.vault_id = p_vault)
        and (
          d.owner_id = p_user
          or exists (select 1 from docs.members m where m.doc_id = d.id and m.user_id = p_user)
        )
    end
  order by c.updated_at
  limit 500;
$$;
-- Server-only. SECURITY INVOKER: the secret key's role can read docs.*; the
-- public roles cannot, and may not call this either.
revoke execute on function docs.crdt_changes(uuid, timestamptz, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The switch.
--
-- The permissive policy on docs.doc_crdt becomes a policy that consults one
-- row. While 'on', the publishable key and a browser session keep the direct
-- access they have today, so a daemon on an older version keeps syncing. Set it
-- 'off' and every direct read returns nothing and every direct write is refused
-- (42501); the API, on the secret key, is unaffected. The grants themselves stay
-- until the follow-up migration revokes them, which is also when this switch
-- goes.
--
-- Its initial value is decided by what the database already holds. A database
-- with CRDT rows has clients that wrote them, some of which may still be on the
-- old path, so it starts 'on'. A database with none -- a fresh install, the test
-- database -- has no such clients and starts locked.
-- ---------------------------------------------------------------------------
insert into docs.app_config (key, value)
select 'crdt_public_access',
       case when exists (select 1 from docs.doc_crdt) then 'on' else 'off' end
on conflict (key) do nothing;

create or replace function docs.crdt_public_access()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select value = 'on' from docs.app_config where key = 'crdt_public_access'),
    false
  );
$$;
-- Evaluated by the policy as anon / authenticated, so they must be able to call
-- it. It returns one boolean and reads one row nobody else can see.
revoke execute on function docs.crdt_public_access() from public;
grant execute on function docs.crdt_public_access() to anon, authenticated;

drop policy if exists permissive on docs.doc_crdt;
drop policy if exists "crdt public access until clients update" on docs.doc_crdt;
create policy "crdt public access until clients update" on docs.doc_crdt
  for all to anon, authenticated
  using (docs.crdt_public_access())
  with check (docs.crdt_public_access());
