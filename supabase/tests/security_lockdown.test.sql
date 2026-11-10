-- What the public key (anon) and a signed-in browser session (authenticated)
-- can do, table by table. Guards 20260915_security_lockdown_stage1.sql: a later
-- migration that re-opens a table, or a new table created without an explicit
-- grant, fails here instead of reaching production.
--
-- Run: `supabase test db` (local stack, all migrations applied).

begin;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- 1. Server-only tables: the public roles get nothing at all.
-- ---------------------------------------------------------------------------
select is(
  has_table_privilege(r, t, p), false,
  format('%s cannot %s %s', r, p, t)
)
from unnest(array[
  'public.attention_boards', 'public.attention_items', 'public.email_accounts',
  'public.learning_diaries', 'public.project_docs', 'public.project_properties',
  'public.reader_documents', 'public.reader_highlights', 'public.reader_messages',
  'public.reader_selections', 'public.skill_files', 'public.skills',
  'public.subscribers', 'public.term_messages', 'public.terms',
  'public.today_todos', 'public.vault_secrets', 'public.work_logs',
  'docs.app_config', 'docs.assets', 'docs.comments', 'docs.documents',
  'docs.folders', 'docs.links', 'docs.members', 'docs.onboarding_seeded',
  'docs.projects', 'docs.steps', 'docs.suggestions', 'docs.vaults'
]) as t
cross join unnest(array['anon', 'authenticated']) as r
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p;

-- RLS stays on, with no allow-everything policy left, so a grant restored by
-- mistake still exposes nothing.
select is(c.relrowsecurity, true, format('RLS is on for %s', t))
from unnest(array[
  'public.subscribers', 'docs.app_config', 'docs.onboarding_seeded',
  'public.skills', 'public.vault_secrets', 'docs.documents', 'docs.members'
]) as t
join pg_class c on c.oid = t::regclass;

select is_empty(
  $$ select schemaname || '.' || tablename || ' / ' || policyname
     from pg_policies
     where qual = 'true'
       and (schemaname || '.' || tablename) in (
         'public.learning_diaries', 'public.project_docs', 'public.project_properties',
         'public.reader_documents', 'public.reader_highlights', 'public.reader_messages',
         'public.reader_selections', 'public.skill_files', 'public.skills',
         'public.term_messages', 'public.terms', 'public.today_todos',
         'public.vault_secrets', 'public.work_logs', 'public.secrets',
         'docs.assets', 'docs.comments', 'docs.documents', 'docs.folders',
         'docs.links', 'docs.members', 'docs.projects', 'docs.steps',
         'docs.suggestions', 'docs.vaults') $$,
  'no allow-everything policy remains on a locked table'
);

-- ---------------------------------------------------------------------------
-- 2. Tables the CLI worker, desktop app and browser still use with the public
--    key (until stage 2): exactly the operations they need, nothing more.
--
--    docs.doc_crdt keeps its grants for one more release: stage 2
--    (20261028100000) put the direct access behind a switch instead of
--    revoking it, so a daemon on the old build keeps syncing until every one
--    has updated. Section 6 covers what the switch does; the follow-up that
--    removes it moves this table to section 1.
-- ---------------------------------------------------------------------------
select is(
  has_table_privilege(r, m.t, m.p), m.allowed,
  format('%s %s %s %s', r, case when m.allowed then 'can' else 'cannot' end, m.p, m.t)
)
from (values
  -- the worker reads and updates these, and never creates or deletes rows
  ('public.api_keys', 'SELECT', true), ('public.api_keys', 'UPDATE', true),
  ('public.api_keys', 'INSERT', false), ('public.api_keys', 'DELETE', false),
  ('public.jobs', 'SELECT', true), ('public.jobs', 'UPDATE', true),
  ('public.jobs', 'INSERT', false), ('public.jobs', 'DELETE', false),
  ('public.tickets', 'SELECT', true), ('public.tickets', 'UPDATE', true),
  ('public.tickets', 'INSERT', false), ('public.tickets', 'DELETE', false),
  ('public.agent_sessions', 'SELECT', true), ('public.agent_sessions', 'UPDATE', true),
  -- INSERT is granted: discover-repos -> reconcileAgentSessions records sessions
  -- it has just found. Stage 1 revoked it on the strength of a code map that
  -- missed that path, and the daemon 401ed on every new session for three days.
  -- worker_writes.test.sql runs the statement itself, which is the test that
  -- would have caught it.
  ('public.agent_sessions', 'INSERT', true), ('public.agent_sessions', 'DELETE', false),
  ('public.agent_spawn_requests', 'SELECT', true), ('public.agent_spawn_requests', 'UPDATE', true),
  ('public.agent_spawn_requests', 'INSERT', false), ('public.agent_spawn_requests', 'DELETE', false),
  ('public.agent_message_requests', 'SELECT', true), ('public.agent_message_requests', 'UPDATE', true),
  ('public.agent_message_requests', 'INSERT', false), ('public.agent_message_requests', 'DELETE', false),
  -- read only
  ('public.user_plans', 'SELECT', true), ('public.user_plans', 'INSERT', false),
  ('public.user_plans', 'UPDATE', false), ('public.user_plans', 'DELETE', false),
  ('public.projects', 'SELECT', true), ('public.projects', 'INSERT', false),
  ('public.projects', 'UPDATE', false), ('public.projects', 'DELETE', false),
  -- the worker posts ticket messages; clients upsert CRDT snapshots
  ('public.ticket_messages', 'INSERT', true), ('public.ticket_messages', 'DELETE', false),
  ('docs.doc_crdt', 'SELECT', true), ('docs.doc_crdt', 'INSERT', true),
  ('docs.doc_crdt', 'UPDATE', true), ('docs.doc_crdt', 'DELETE', false)
) as m(t, p, allowed)
cross join unnest(array['anon', 'authenticated']) as r;

-- Nobody on the public key can truncate anything.
select is(has_table_privilege('anon', t, 'TRUNCATE'), false, format('anon cannot TRUNCATE %s', t))
from unnest(array[
  'public.api_keys', 'public.jobs', 'public.tickets', 'public.ticket_messages',
  'public.agent_sessions', 'public.user_plans', 'docs.doc_crdt'
]) as t;

-- ---------------------------------------------------------------------------
-- 3. Functions.
-- ---------------------------------------------------------------------------
select is(has_function_privilege(r, f, 'EXECUTE'), false, format('%s cannot call %s', r, f))
from unnest(array[
  'public.sweep_unconfirmed_api_keys()',
  'docs.convert_folder_to_vault(uuid, text, jsonb)',
  -- stage 2: the change feed is the API's, and the topic parser is the
  -- capability function's own business
  'docs.crdt_changes(uuid, timestamptz, uuid, boolean)',
  'docs.crdt_topic_doc(text)'
]) as f
cross join unnest(array['anon', 'authenticated']) as r;

-- The one function a signed-in session may call: Realtime evaluates the
-- doc-channel policies as `authenticated`, and they call this. Never anon.
select is(has_function_privilege('authenticated', 'docs.crdt_topic_capability(text)', 'EXECUTE'), true,
  'authenticated can call crdt_topic_capability (the Realtime policies do)');
select is(has_function_privilege('anon', 'docs.crdt_topic_capability(text)', 'EXECUTE'), false,
  'anon cannot call crdt_topic_capability');

-- The change feed is served by the API on the secret key, whose role is
-- service_role. A new function's EXECUTE for that role comes from PUBLIC, and
-- stage 2 revoked PUBLIC — so the grant has to be explicit, or every daemon
-- poll is a 503 (20261029190000). postgres owns the function and would pass
-- this test either way; service_role is the role that matters.
select is(has_function_privilege('service_role', 'docs.crdt_changes(uuid, timestamptz, uuid, boolean)', 'EXECUTE'), true,
  'service_role can call crdt_changes (the API serves the change feed with it)');

-- The worker's own functions keep working until stage 2 moves them.
select is(has_function_privilege('anon', f, 'EXECUTE'), true, format('anon can still call %s', f))
from unnest(array[
  'public.claim_next_job(uuid, text)',
  'public.reclaim_stale()',
  'public.report_worker_repos(uuid, jsonb)',
  'public.report_worker_sessions(uuid, jsonb)',
  'public.take_repo_rescan(uuid)'
]) as f;

-- ---------------------------------------------------------------------------
-- 4. Default privileges: a table or function created later starts private.
-- ---------------------------------------------------------------------------
create table public.__lockdown_probe (id int);
create table docs.__lockdown_probe (id int);

select is(has_table_privilege('anon', 'public.__lockdown_probe', 'SELECT'), false,
  'a new public table is not readable by anon');
select is(has_table_privilege('authenticated', 'public.__lockdown_probe', 'INSERT'), false,
  'a new public table is not writable by authenticated');
select is(has_table_privilege('anon', 'docs.__lockdown_probe', 'SELECT'), false,
  'a new docs table is not readable by anon');

-- Functions get no such guarantee: Supabase keeps its own default-privileges
-- entry (owned by supabase_admin) granting EXECUTE on every new function to
-- anon and authenticated, and we cannot edit that entry. A new function
-- therefore lands callable by the public key unless its own migration revokes
-- it -- which is how sweep_unconfirmed_api_keys ended up exposed.
--
-- So the rule is enforced here instead of being assumed: any function reachable
-- on the public key must be one the worker genuinely calls. Add an RPC without
-- revoking execute and this fails, naming it.
select is_empty(
  $$ select n.nspname || '.' || p.proname
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'docs')
       and p.prokind = 'f'
       and p.prorettype <> 'pg_catalog.trigger'::regtype
       -- extension-owned functions (pgTAP in the test database) are not ours
       and not exists (
         select 1 from pg_depend d
         where d.objid = p.oid and d.deptype = 'e')
       -- stage 2 (worker): the transitional switch the worker-table policies
       -- read as whichever public role is asking; one boolean, nothing else
       and p.proname <> 'worker_public_access'
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
            or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       and p.proname not in (
         -- the CLI worker's own RPCs, until stage 2 moves it off the public key
         'claim_next_job', 'reclaim_stale', 'report_worker_repos',
         'report_worker_sessions', 'take_repo_rescan', 'request_repo_rescan',
         -- stage 2 (CRDT): the Realtime doc-channel policies run as
         -- `authenticated` and call this; it returns one word about one row
         'crdt_topic_capability',
         -- stage 2 (CRDT): the transitional switch, read by the doc_crdt
         -- policy as whichever public role is asking; one boolean
         'crdt_public_access') $$,
  'no function outside the worker allowlist is callable by anon or authenticated'
);

-- ---------------------------------------------------------------------------
-- 5. Behaviour through the real roles, the way PostgREST runs requests.
-- ---------------------------------------------------------------------------
-- Fixtures, created as the owner before switching roles.
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'owner-b@test.local', 'authenticated', 'authenticated');

-- secrets.project is a foreign key to projects(slug), so the project comes first.
insert into public.projects (slug, name) values ('p', 'Test project');

insert into public.secrets (id, project, name, ciphertext, iv, auth_tag, owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'p', 'A_KEY', 'c', 'i', 't', '00000000-0000-0000-0000-00000000000a');

insert into docs.documents (id, doc_json, owner_id) values
  ('00000000-0000-0000-0000-0000000000d1', '{}', '00000000-0000-0000-0000-00000000000a');

-- ---------------------------------------------------------------------------
-- 7. Stage 2: the ticket worker's tables and RPCs (20261029120000).
--
-- The web API is the worker's only upstream: it resolves the worker's key to
-- an owner and reads and writes these tables with the secret key. The policies
-- here are what stand between every other credential and the tables, and the
-- six RPCs refuse a public caller outright -- the owner id they take can no
-- longer be forged from outside.
--
-- It sits here, before 5a, on purpose: a database built from scratch starts
-- with the switch OFF, and that is the state checked first. 5a below is the
-- OLD path -- a worker that has not updated -- so 7d leaves the switch on for
-- it.
-- ---------------------------------------------------------------------------
select is((select value from docs.app_config where key = 'worker_public_access'), 'off',
  'the worker direct-access switch is off on a database built from scratch');

-- Row security is on everywhere the worker used to write, and no
-- allow-everything policy remains on any of it.
select is(c.relrowsecurity, true, format('RLS is on for %s', t))
from unnest(array[
  'public.api_keys', 'public.jobs', 'public.tickets', 'public.ticket_messages',
  'public.projects', 'public.user_plans', 'public.agent_sessions',
  'public.agent_spawn_requests', 'public.agent_message_requests',
  'public.workers', 'public.worker_repos', 'public.worker_sessions'
]) as t
join pg_class c on c.oid = t::regclass;

select is_empty(
  $$ select tablename || ' / ' || policyname from pg_policies
     where schemaname = 'public' and qual = 'true'
       and tablename in (
         'api_keys', 'jobs', 'tickets', 'ticket_messages', 'projects', 'user_plans',
         'agent_sessions', 'agent_spawn_requests', 'agent_message_requests',
         'workers', 'worker_repos', 'worker_sessions') $$,
  'no allow-everything policy remains on a worker table'
);

-- Fixtures: owner A's ticket e1 with a queued job e2, an agent slot e3 with a
-- queued spawn request e4, a key e5, a plan, and a worker presence row.
insert into public.tickets (id, project, title, description, requester, owner_id) values
  ('00000000-0000-0000-0000-0000000000e1', 'p', 'T', 'D', 'test', '00000000-0000-0000-0000-00000000000a');
insert into public.jobs (id, ticket_id, owner_id, status) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-00000000000a', 'queued');
insert into public.agent_sessions (id, owner_id, name, provider, session_token, status) values
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000000a',
   'Ada', 'claude_code', 'sess_e3', 'pending');
insert into public.agent_spawn_requests (id, owner_id, agent_session_id, project, prompt) values
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-0000000000e3', 'p', 'Hi, your name is Ada');
insert into public.api_keys (id, key_prefix, key_hash, owner_id, name) values
  ('00000000-0000-0000-0000-0000000000e5', 'jsk_e5', 'hash_e5', '00000000-0000-0000-0000-00000000000a', 'laptop');
insert into public.user_plans (user_id, plan) values ('00000000-0000-0000-0000-00000000000a', 'pro');
-- (5a's claim already stamped A's presence; make it an old build asking for a rescan.)
insert into public.workers (owner_id, last_poll_at, worker_version, rescan_requested_at) values
  ('00000000-0000-0000-0000-00000000000a', now(), '0.7.8', now())
on conflict (owner_id) do update set worker_version = '0.7.8', rescan_requested_at = now();

-- 7a. The public key: every worker table answers nothing, every write is
--     refused, every RPC is refused before it touches a row.
set local role anon;

select is((select count(*)::int from public.jobs), 0, 'anon: sees no jobs');
select is((select count(*)::int from public.tickets), 0, 'anon: sees no tickets');
select is((select count(*)::int from public.api_keys), 0, 'anon: sees no API keys');
select is((select count(*)::int from public.agent_sessions), 0, 'anon: sees no agent sessions');
select is((select count(*)::int from public.agent_spawn_requests), 0, 'anon: sees no spawn requests');
select is((select count(*)::int from public.agent_message_requests), 0, 'anon: sees no message requests');
select is((select count(*)::int from public.user_plans), 0, 'anon: sees no plans');
select is((select count(*)::int from public.projects), 0, 'anon: sees no projects');
select is((select count(*)::int from public.ticket_messages), 0, 'anon: sees no ticket messages');
select is((select count(*)::int from public.workers), 0, 'anon: sees no worker presence');
select is((select count(*)::int from public.worker_repos), 0, 'anon: sees no worker repos');
select is((select count(*)::int from public.worker_sessions), 0, 'anon: sees no worker sessions');

select throws_ok($$ insert into public.ticket_messages (ticket_id, role, content)
                    values ('00000000-0000-0000-0000-0000000000e1', 'assistant', 'forged') $$,
  '42501', null, 'anon: posting into a ticket thread is refused');
select throws_ok($$ insert into public.agent_sessions (owner_id, name, provider, session_token)
                    values ('00000000-0000-0000-0000-00000000000a', 'planted', 'claude_code', 'sess_x') $$,
  '42501', null, 'anon: planting an agent session is refused');
select throws_ok($$ insert into public.workers (owner_id) values ('00000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'anon: faking worker presence is refused');
with hijack as (
  update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-0000000000e2' returning 1
)
select is((select count(*)::int from hijack), 0, 'anon: finishing someone''s job touches no row');
with hijack as (
  update public.tickets set cc_state = 'error' where id = '00000000-0000-0000-0000-0000000000e1' returning 1
)
select is((select count(*)::int from hijack), 0, 'anon: rewriting someone''s ticket touches no row');
with hijack as (
  update public.api_keys set claude_version = 'x' where id = '00000000-0000-0000-0000-0000000000e5' returning 1
)
select is((select count(*)::int from hijack), 0, 'anon: editing someone''s key touches no row');
with hijack as (
  update public.agent_spawn_requests set status = 'running'
  where id = '00000000-0000-0000-0000-0000000000e4' returning 1
)
select is((select count(*)::int from hijack), 0, 'anon: claiming someone''s spawn request touches no row');

select throws_ok($$ select public.claim_next_job('00000000-0000-0000-0000-00000000000a', '0.7.8') $$,
  '42501', null, 'anon: claim_next_job is refused');
select throws_ok($$ select public.reclaim_stale() $$,
  '42501', null, 'anon: reclaim_stale is refused');
select throws_ok($$ select public.report_worker_repos('00000000-0000-0000-0000-00000000000a',
                      '[{"cwd": "/x", "status": "ready"}]'::jsonb) $$,
  '42501', null, 'anon: report_worker_repos is refused');
select throws_ok($$ select public.report_worker_sessions('00000000-0000-0000-0000-00000000000a', '[]'::jsonb) $$,
  '42501', null, 'anon: report_worker_sessions is refused');
select throws_ok($$ select public.take_repo_rescan('00000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'anon: take_repo_rescan is refused');
select throws_ok($$ select public.request_repo_rescan('00000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'anon: request_repo_rescan is refused');

reset role;

-- 7b. A signed-in session. The same refusals -- with one exception: the board
--     and the sidebar read the user's OWN tickets directly and subscribe to
--     Realtime changes on them, so an owner keeps reading their rows, and only
--     theirs. Nothing else, and nothing of anyone else's.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);

select is((select count(*)::int from public.tickets), 1, 'owner A''s session reads A''s own tickets');
select is((select count(*)::int from public.jobs), 0, 'owner A''s session sees no jobs — the API serves them');
select is((select count(*)::int from public.api_keys), 0, 'owner A''s session sees no key rows');
select is((select count(*)::int from public.agent_sessions), 0, 'owner A''s session sees no agent session rows');
with hijack as (
  update public.tickets set cc_state = 'error' where id = '00000000-0000-0000-0000-0000000000e1' returning 1
)
select is((select count(*)::int from hijack), 0, 'owner A''s session cannot write their ticket directly either');
select throws_ok($$ insert into public.ticket_messages (ticket_id, role, content)
                    values ('00000000-0000-0000-0000-0000000000e1', 'assistant', 'x') $$,
  '42501', null, 'owner A''s session cannot post into the thread directly');
select throws_ok($$ select public.claim_next_job('00000000-0000-0000-0000-00000000000a', '0.7.8') $$,
  '42501', null, 'owner A''s session cannot claim jobs directly');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}', true);
select is((select count(*)::int from public.tickets), 0, 'owner B''s session sees none of A''s tickets');

reset role;

-- 7c. The server path: what the API does on the worker's behalf, as the
--     secret key's role, with the switch off. Every write the worker used to
--     make itself still lands -- and the RPCs take the owner the API passes.
--
--     The privileges first, by name. pgTAP runs as postgres, the owner, which
--     every grant is invisible to; and `revoke ... from public` takes EXECUTE
--     from service_role too when that is where its EXECUTE came from (the
--     CRDT half learnt this in production: every daemon poll 503ed until an
--     explicit grant). So the API's role is asserted outright, on the switch
--     function, the six RPCs and the twelve tables, not inferred from the
--     statements below succeeding on a database whose defaults may differ.
select is(has_function_privilege('service_role', f, 'EXECUTE'), true, format('service_role can call %s', f))
from unnest(array[
  'public.worker_public_access()',
  'public.claim_next_job(uuid, text)',
  'public.reclaim_stale()',
  'public.report_worker_repos(uuid, jsonb)',
  'public.report_worker_sessions(uuid, jsonb)',
  'public.take_repo_rescan(uuid)',
  'public.request_repo_rescan(uuid)'
]) as f;
select is(has_table_privilege('service_role', t, p), true, format('service_role can %s %s', p, t))
from unnest(array[
  'public.api_keys', 'public.jobs', 'public.tickets', 'public.ticket_messages',
  'public.projects', 'public.user_plans', 'public.agent_sessions',
  'public.agent_spawn_requests', 'public.agent_message_requests',
  'public.workers', 'public.worker_repos', 'public.worker_sessions'
]) as t
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p;

set local role service_role;

select is((public.claim_next_job('00000000-0000-0000-0000-00000000000a', '0.8.0')).id,
  '00000000-0000-0000-0000-0000000000e2'::uuid, 'the API claims the owner''s queued job');
select is((select worker_version from public.workers where owner_id = '00000000-0000-0000-0000-00000000000a'),
  '0.8.0', 'the claim recorded the worker''s version as presence');
select is(public.take_repo_rescan('00000000-0000-0000-0000-00000000000a'), true,
  'the API takes the pending rescan request');
select is(public.take_repo_rescan('00000000-0000-0000-0000-00000000000a'), false,
  '…exactly once');
select lives_ok($$ update public.jobs set claimed_at = now()
                   where id = '00000000-0000-0000-0000-0000000000e2' and status = 'running' $$,
  'the API heartbeats the running job');
select lives_ok($$ update public.tickets set cc_state = 'running', cc_last_run = now()
                   where id = '00000000-0000-0000-0000-0000000000e1' $$,
  'the API reports progress onto the ticket');
select lives_ok($$ insert into public.ticket_messages (ticket_id, role, content)
                   values ('00000000-0000-0000-0000-0000000000e1', 'assistant', 'done') $$,
  'the API posts the run''s reply');
select lives_ok($$ update public.jobs set status = 'done', finished_at = now()
                   where id = '00000000-0000-0000-0000-0000000000e2' $$,
  'the API finishes the job');
select lives_ok($$ update public.api_keys set claude_version = '2.1.276'
                   where id = '00000000-0000-0000-0000-0000000000e5' $$,
  'the API records the Claude Code version on the key');
select lives_ok($$ select public.report_worker_repos('00000000-0000-0000-0000-00000000000a',
                     '[{"cwd": "/repo", "status": "ready", "last_active": "2026-10-29T00:00:00Z"}]'::jsonb) $$,
  'the API reports the worker''s repos');
select lives_ok($$ select public.report_worker_sessions('00000000-0000-0000-0000-00000000000a',
                     '[{"session_id": "s1", "repo_cwd": "/repo", "last_active": "2026-10-29T00:00:00Z"}]'::jsonb) $$,
  'the API reports the worker''s sessions');
select lives_ok($$ insert into public.agent_sessions (owner_id, name, provider, session_token, external_session_id)
                   values ('00000000-0000-0000-0000-00000000000a', 'discovered', 'claude_code', 'sess_s1', 's1') $$,
  'the API records a newly discovered agent session');
select lives_ok($$ update public.agent_spawn_requests set status = 'running', claimed_at = now()
                   where id = '00000000-0000-0000-0000-0000000000e4' and status = 'queued' $$,
  'the API claims the spawn request');
select lives_ok($$ select public.reclaim_stale() $$, 'the API runs the staleness sweep');
select lives_ok($$ select public.request_repo_rescan('00000000-0000-0000-0000-00000000000a') $$,
  'the web API asks the worker for a rescan');

reset role;

-- 7d. The switch the other way: a database whose workers have not all updated
--     keeps the old path open until they have. Flipping it is the cutover, and
--     flipping it back is the rollback.
update docs.app_config set value = 'on' where key = 'worker_public_access';
set local role anon;
select lives_ok($$ select public.claim_next_job('00000000-0000-0000-0000-00000000000a', '0.7.8') $$,
  'with the switch on, a worker on the old build can still claim');
select is((select count(*)::int from public.tickets), 1,
  'with the switch on, the old build can still read tickets');
reset role;
update docs.app_config set value = 'off' where key = 'worker_public_access';
set local role anon;
select is((select count(*)::int from public.tickets), 0,
  'with the switch off again, the public key sees nothing');
reset role;
-- Left ON from here: 5a is the old path and needs it.
update docs.app_config set value = 'on' where key = 'worker_public_access';


-- 5a. The public key.
set local role anon;

select throws_ok('select count(*) from public.skills', '42501', null, 'anon: reading a locked table is refused');
select throws_ok('select count(*) from docs.documents', '42501', null, 'anon: reading documents is refused');
select throws_ok('select count(*) from public.vault_secrets', '42501', null, 'anon: reading vault secrets is refused');
select throws_ok('select count(*) from public.secrets', '42501', null, 'anon: reading secrets is refused');
select throws_ok($$ insert into public.api_keys (key_prefix, key_hash) values ('mk_x', 'h') $$,
  '42501', null, 'anon: minting an API key is refused');
select throws_ok($$ insert into public.jobs (ticket_id) values (gen_random_uuid()) $$,
  '42501', null, 'anon: queueing a job is refused');
select throws_ok($$ insert into public.user_plans (user_id) values (gen_random_uuid()) $$,
  '42501', null, 'anon: granting a plan is refused');
select throws_ok('delete from public.tickets', '42501', null, 'anon: deleting tickets is refused');
select throws_ok('select public.sweep_unconfirmed_api_keys()', '42501', null,
  'anon: the api-key sweep is refused');

-- What the worker does today still works.
select lives_ok('select count(*) from public.jobs', 'anon: the worker can still read jobs');
select lives_ok('update public.jobs set ticket_id = ticket_id where false',
  'anon: the worker can still update jobs');
select lives_ok($$ select public.claim_next_job('00000000-0000-0000-0000-00000000000a', '0.0.0') $$,
  'anon: the worker can still claim jobs');
-- The CRDT snapshot upsert the old clients make: refused on a database whose
-- switch is off (this one — see section 6, which also turns it on and checks
-- the old path still works for a daemon that has not updated yet).
select throws_ok($$ insert into docs.doc_crdt (doc_id, state)
                   values ('00000000-0000-0000-0000-0000000000d1', '')
                   on conflict (doc_id) do update set state = excluded.state $$,
  '42501', null, 'anon: upserting a CRDT snapshot directly is refused');

reset role;

-- 5b. A signed-in user sees only their own secrets.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);

select is((select count(*)::int from public.secrets), 1, 'owner A sees their own secret');
select lives_ok($$ insert into public.secrets (project, name, ciphertext, iv, auth_tag, owner_id)
                   values ('p', 'A_SECOND', 'c', 'i', 't', '00000000-0000-0000-0000-00000000000a') $$,
  'owner A can add a secret for themselves');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}', true);

select is((select count(*)::int from public.secrets), 0, 'owner B cannot see A''s secrets');
select throws_ok($$ insert into public.secrets (project, name, ciphertext, iv, auth_tag, owner_id)
                    values ('p', 'PLANTED', 'c', 'i', 't', '00000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'owner B cannot write a secret into A''s account');
with hijack as (
  update public.secrets set name = 'HIJACKED'
  where id = '00000000-0000-0000-0000-0000000000a1'
  returning 1
)
select is((select count(*)::int from hijack), 0, 'owner B cannot rename A''s secret');

reset role;

-- ---------------------------------------------------------------------------
-- 6. Stage 2: a document's CRDT state (20261028100000).
--
-- The API is the only reader and writer of docs.doc_crdt, on the secret key;
-- the policies here are what stand between every other credential and the
-- table. Live edits travel on private Realtime channels whose policies ask the
-- same question the API asks: what is this user's capability on this document.
-- ---------------------------------------------------------------------------
-- A fresh database starts locked: the switch is 'on' only where CRDT rows
-- already existed when the migration ran, which is where old clients are.
select is((select value from docs.app_config where key = 'crdt_public_access'), 'off',
  'the direct-access switch is off on a database built from scratch');

-- Fixtures: owner A's document d1 (from section 5) with a stored snapshot; B a
-- viewer on it, C an editor, D nobody.
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000c', 'editor-c@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', 'stranger-d@test.local', 'authenticated', 'authenticated');
insert into docs.members (doc_id, user_id, capability) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000b', 'viewer'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000c', 'editor');
insert into docs.doc_crdt (doc_id, state, version) values
  ('00000000-0000-0000-0000-0000000000d1', 'AAA=', 1);

-- The stage-2 columns and policies are in place.
select has_column('docs', 'doc_crdt', 'version', 'doc_crdt carries the version the server CASes on');
select is_empty(
  $$ select policyname from pg_policies
     where schemaname = 'docs' and tablename = 'doc_crdt' and qual = 'true' $$,
  'no allow-everything policy remains on doc_crdt'
);
select bag_eq(
  $$ select policyname, cmd, roles::text from pg_policies
     where schemaname = 'realtime' and tablename = 'messages' $$,
  $$ values ('doc channel: members receive', 'SELECT', '{authenticated}'),
            ('doc channel: editors send', 'INSERT', '{authenticated}') $$,
  'the doc-channel policies are the only Realtime policies, and only for signed-in users'
);

-- 6a. The viewer. Reading the document is theirs; writing its state is not,
--     and that is true however they come at it: the API refuses the write
--     (packages/features/docs/test/crdt-handlers.test.ts), and so does the
--     table itself.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}', true);

select is((select count(*)::int from docs.doc_crdt), 0,
  'a viewer''s session sees no snapshot rows directly — the API serves them');
select throws_ok($$ insert into docs.doc_crdt (doc_id, state)
                    values ('00000000-0000-0000-0000-0000000000d1', 'Zm9yZ2Vk')
                    on conflict (doc_id) do update set state = excluded.state $$,
  '42501', null, 'a viewer''s write to a CRDT snapshot is refused');
with hijack as (
  update docs.doc_crdt set state = 'Zm9yZ2Vk'
  where doc_id = '00000000-0000-0000-0000-0000000000d1'
  returning 1
)
select is((select count(*)::int from hijack), 0, 'a viewer''s update touches no snapshot row');

-- On the live channel a viewer may listen and may not speak.
select is(docs.crdt_topic_capability('doc:00000000-0000-0000-0000-0000000000d1'), 'viewer',
  'the channel policy sees B as a viewer of d1');

-- 6b. The owner's own session, on an old browser build that still writes the
--     table directly: refused too. There is one writer now.
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);
select throws_ok($$ insert into docs.doc_crdt (doc_id, state)
                    values ('00000000-0000-0000-0000-0000000000d1', 'b3du')
                    on conflict (doc_id) do update set state = excluded.state $$,
  '42501', null, 'even the owner''s session cannot write the table directly');
select is(docs.crdt_topic_capability('doc:00000000-0000-0000-0000-0000000000d1'), 'owner',
  'the channel policy sees A as the owner of d1');

-- 6c. The editor and the stranger, as the channel policies see them.
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}', true);
select is(docs.crdt_topic_capability('doc:00000000-0000-0000-0000-0000000000d1'), 'editor',
  'the channel policy sees C as an editor of d1');
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}', true);
select is(docs.crdt_topic_capability('doc:00000000-0000-0000-0000-0000000000d1'), null,
  'the channel policy sees D as nobody on d1');
select is(docs.crdt_topic_capability('crdt:00000000-0000-0000-0000-0000000000d1'), null,
  'the legacy public topic is not a private channel anyone is authorized on');
select is(docs.crdt_topic_capability('doc:not-a-uuid'), null,
  'a malformed topic authorizes nobody');

reset role;

-- 6d. The policies, through realtime.messages itself. Realtime checks them on
--     join by running the same statements with the channel's name in the
--     `realtime.topic` setting (that is what realtime.topic() reads -- not the
--     row); a partition in 2099 keeps the rows out of any real day's partition
--     (and this transaction rolls back anyway).
create table realtime.messages_lockdown_probe
  partition of realtime.messages for values from ('2099-01-01') to ('2099-01-02');
insert into realtime.messages (topic, extension, payload, event, private, inserted_at) values
  ('doc:00000000-0000-0000-0000-0000000000d1', 'broadcast', '{"u":""}', 'update', true, '2099-01-01');

set local role authenticated;
select set_config('realtime.topic', 'doc:00000000-0000-0000-0000-0000000000d1', true);
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}', true);
select is((select count(*)::int from realtime.messages
            where topic = 'doc:00000000-0000-0000-0000-0000000000d1'), 1,
  'a viewer may receive on the document''s channel');
select throws_ok($$ insert into realtime.messages (topic, extension, payload, event, private, inserted_at)
                    values ('doc:00000000-0000-0000-0000-0000000000d1', 'broadcast', '{"u":""}',
                            'update', true, '2099-01-01') $$,
  '42501', null, 'a viewer may not send on the document''s channel');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}', true);
select lives_ok($$ insert into realtime.messages (topic, extension, payload, event, private, inserted_at)
                   values ('doc:00000000-0000-0000-0000-0000000000d1', 'broadcast', '{"u":""}',
                           'update', true, '2099-01-01') $$,
  'an editor may send on the document''s channel');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000d", "role": "authenticated"}', true);
select is((select count(*)::int from realtime.messages
            where topic = 'doc:00000000-0000-0000-0000-0000000000d1'), 0,
  'a stranger receives nothing on the document''s channel');
select throws_ok($$ insert into realtime.messages (topic, extension, payload, event, private, inserted_at)
                    values ('doc:00000000-0000-0000-0000-0000000000d1', 'broadcast', '{"u":""}',
                            'update', true, '2099-01-01') $$,
  '42501', null, 'a stranger may not send on the document''s channel');

reset role;

-- 6f. The changes feed, scoped the two ways a daemon's folder can be. d1 sits
--     in owner A's vault; C is an editor on it. A second document d2, A's
--     alone, tells the scopes apart.
insert into docs.vaults (id, name, owner_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'A''s vault', '00000000-0000-0000-0000-00000000000a');
update docs.documents set vault_id = '00000000-0000-0000-0000-0000000000a1'
  where id = '00000000-0000-0000-0000-0000000000d1';
insert into docs.documents (id, doc_json, owner_id, vault_id) values
  ('00000000-0000-0000-0000-0000000000d2', '{}', '00000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-0000000000a1');
insert into docs.doc_crdt (doc_id, state, version) values
  ('00000000-0000-0000-0000-0000000000d2', 'AAA=', 1);

-- A's own vault folder: both documents, because A owns both.
select bag_eq(
  $$ select doc_id::text from docs.crdt_changes('00000000-0000-0000-0000-00000000000a',
       '2000-01-01', '00000000-0000-0000-0000-0000000000a1') $$,
  $$ values ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000d2') $$,
  'the owner''s vault feed reports every document in it'
);
-- A's Shared Vault: nothing — A owns everything A can see.
select is_empty(
  $$ select doc_id from docs.crdt_changes('00000000-0000-0000-0000-00000000000a',
       '2000-01-01', null, true) $$,
  'the owner''s shared feed is empty — nothing is shared WITH them'
);
-- C's Shared Vault: d1, the one document shared with C, though it sits in A's vault.
select bag_eq(
  $$ select doc_id::text from docs.crdt_changes('00000000-0000-0000-0000-00000000000c',
       '2000-01-01', null, true) $$,
  $$ values ('00000000-0000-0000-0000-0000000000d1') $$,
  'a member''s shared feed reports the document shared with them, whichever vault it is in'
);
-- The shared scope ignores the vault: C's shared feed with A's vault named is the same.
select bag_eq(
  $$ select doc_id::text from docs.crdt_changes('00000000-0000-0000-0000-00000000000c',
       '2000-01-01', '00000000-0000-0000-0000-0000000000a1', true) $$,
  $$ values ('00000000-0000-0000-0000-0000000000d1') $$,
  'the shared scope ignores a vault passed with it'
);
-- C has no vault of their own; scoping to A's vault as if it were theirs still
-- yields d1 (membership, not ownership, admits) — which is why a daemon never
-- passes another user's vault id, and why the shared scope exists.
select bag_eq(
  $$ select doc_id::text from docs.crdt_changes('00000000-0000-0000-0000-00000000000c',
       '2000-01-01', null) $$,
  $$ values ('00000000-0000-0000-0000-0000000000d1') $$,
  'unscoped, a member sees what they own plus what is shared with them'
);
-- D, a stranger: nothing in any scope.
select is_empty(
  $$ select doc_id from docs.crdt_changes('00000000-0000-0000-0000-00000000000d', '2000-01-01') $$,
  'a stranger''s feed is empty');
select is_empty(
  $$ select doc_id from docs.crdt_changes('00000000-0000-0000-0000-00000000000d', '2000-01-01', null, true) $$,
  'a stranger''s shared feed is empty');
-- A trashed document leaves every feed.
update docs.documents set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000d1';
select is_empty(
  $$ select doc_id from docs.crdt_changes('00000000-0000-0000-0000-00000000000c', '2000-01-01', null, true) $$,
  'a trashed shared document is not reported');
update docs.documents set deleted_at = null where id = '00000000-0000-0000-0000-0000000000d1';
-- d2 was this section's; 6e counts snapshot rows and expects d1's alone.
delete from docs.doc_crdt where doc_id = '00000000-0000-0000-0000-0000000000d2';
delete from docs.documents where id = '00000000-0000-0000-0000-0000000000d2';

-- 6e. The switch, the other way: a database whose daemons have not all
--     updated keeps the old path open until they have. Flipping it is the
--     cutover, and flipping it back is the rollback.
update docs.app_config set value = 'on' where key = 'crdt_public_access';
set local role anon;
select lives_ok($$ insert into docs.doc_crdt (doc_id, state)
                   values ('00000000-0000-0000-0000-0000000000d1', 'bGVnYWN5')
                   on conflict (doc_id) do update set state = excluded.state $$,
  'with the switch on, an old daemon on the public key can still upsert a snapshot');
select is((select count(*)::int from docs.doc_crdt), 1,
  'with the switch on, an old client on the public key can still read snapshots');
reset role;
update docs.app_config set value = 'off' where key = 'crdt_public_access';
set local role anon;
select is((select count(*)::int from docs.doc_crdt), 0,
  'with the switch off again, the public key sees nothing');
reset role;

-- ---------------------------------------------------------------------------
-- 8. The Shared Vault (20261029100000): a member's own path for a document
--    shared with them -- where it sits in THEIR folder, never the owner's.
-- ---------------------------------------------------------------------------
select has_column('docs', 'members', 'path', 'members carry the member''s own Shared Vault path');
select col_is_null('docs', 'members', 'path', 'a member''s path is null until they file the document');
select col_type_is('docs', 'members', 'path', 'text', 'a member''s path is text');

-- Filing is per member: C files d1, and A's document and B's membership are untouched.
update docs.members set path = 'Ada/Plan.md'
  where doc_id = '00000000-0000-0000-0000-0000000000d1' and user_id = '00000000-0000-0000-0000-00000000000c';
select is((select path from docs.members
            where doc_id = '00000000-0000-0000-0000-0000000000d1' and user_id = '00000000-0000-0000-0000-00000000000c'),
  'Ada/Plan.md', 'the member''s path is theirs');
select is((select path from docs.members
            where doc_id = '00000000-0000-0000-0000-0000000000d1' and user_id = '00000000-0000-0000-0000-00000000000b'),
  null, 'another member''s path is unaffected');
select is((select path from docs.documents where id = '00000000-0000-0000-0000-0000000000d1'),
  null, 'the owner''s path is unaffected');

-- Still nobody's to read or write on the public key (section 1 covers the
-- table; this pins that the new column did not arrive with a grant of its own).
select is(has_column_privilege('anon', 'docs.members', 'path', 'SELECT'), false, 'anon cannot read a member''s path');
select is(has_column_privilege('authenticated', 'docs.members', 'path', 'UPDATE'), false, 'authenticated cannot write a member''s path');

select * from finish();
rollback;
