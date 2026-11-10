-- The writes the worker actually makes, run as the worker actually runs them.
--
-- security_lockdown.test.sql asserts the permission matrix: which role may do
-- what to which table. It passed while the daemon was 401ing on every newly
-- discovered agent session, because "anon cannot INSERT into agent_sessions"
-- was both the assertion and the bug. A matrix cannot tell you which cells a
-- real code path needs.
--
-- So this file is the other half: for each write the CLI worker performs on the
-- publishable key, the statement itself, as anon. It fails when a lockdown takes
-- away something the daemon needs -- which is the failure the matrix cannot see.
--
-- Keep it in step with the worker: a new .insert/.update in a path that runs on
-- the public key belongs here on the same commit.

begin;
select * from no_plan();

-- Fixtures owned by the worker's owner id, created before dropping privilege.
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000aa01', 'worker@test.local', 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.projects (slug, name) values ('wtest', 'Worker test')
on conflict (slug) do nothing;

insert into public.tickets (id, project, title, description, requester, owner_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'wtest', 'T', 'D', 'test',
   '00000000-0000-0000-0000-00000000aa01')
on conflict (id) do nothing;

insert into public.jobs (id, ticket_id, owner_id, status) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-00000000aa01', 'queued')
on conflict (id) do nothing;

-- Stage 2 (20261029120000): the worker no longer runs these statements itself.
-- It sends each one to the web API with its key, and the API runs it with the
-- secret key -- service_role, below -- passing the owner the key resolved to.
-- With the switch that keeps the old path open turned OFF, as it is on a
-- database built from scratch and will be in production at the cutover, every
-- write the worker needs still lands through that path. This half is what a
-- future revoke must keep green.
update docs.app_config set value = 'off' where key = 'worker_public_access';
set local role service_role;

select is((public.claim_next_job('00000000-0000-0000-0000-00000000aa01', '0.8.0')).id,
  '00000000-0000-0000-0000-0000000000d1'::uuid,
  'the API claims the job on the worker''s behalf (POST /worker/claim)');
select lives_ok(
  $$ update public.jobs set claimed_at = now() where id = '00000000-0000-0000-0000-0000000000d1' and status = 'running' $$,
  'the API heartbeats the job (POST /worker/heartbeat)'
);
select lives_ok(
  $$ update public.tickets set cc_state = 'running', cc_last_run = now()
     where id = '00000000-0000-0000-0000-0000000000c1' $$,
  'the API reports progress onto the ticket (PATCH /tickets/:id)'
);
select lives_ok(
  $$ insert into public.ticket_messages (ticket_id, role, content)
     values ('00000000-0000-0000-0000-0000000000c1', 'assistant', 'done') $$,
  'the API posts the run''s reply (POST /tickets/:id/messages)'
);
select lives_ok(
  $$ update public.jobs set status = 'done', finished_at = now()
     where id = '00000000-0000-0000-0000-0000000000d1' $$,
  'the API finishes the job (POST /worker/jobs/:id/finish)'
);
select lives_ok(
  $$ update public.api_keys set claude_version = '2.1.276' where key_prefix = 'nothing_matches' $$,
  'the API records the Claude Code version (PATCH /worker/claude-version)'
);
select lives_ok(
  $$ select public.report_worker_repos('00000000-0000-0000-0000-00000000aa01', '[]'::jsonb) $$,
  'the API reports the worker''s repos (POST /worker/repos)'
);
select lives_ok(
  $$ select public.report_worker_sessions('00000000-0000-0000-0000-00000000aa01', '[]'::jsonb) $$,
  'the API reports the worker''s sessions (POST /worker/sessions)'
);
select lives_ok(
  $$ insert into public.agent_sessions
       (owner_id, name, provider, session_token, external_session_id, status)
     values ('00000000-0000-0000-0000-00000000aa01', 'discovered session',
             'claude_code', 'tok_api', 'ext_api', 'active') $$,
  'the API records a newly discovered agent session'
);
select lives_ok(
  $$ select public.take_repo_rescan('00000000-0000-0000-0000-00000000aa01') $$,
  'the API takes a rescan request (in the claim response)'
);
select lives_ok(
  $$ update public.agent_spawn_requests set claimed_at = now() where id = gen_random_uuid() $$,
  'the API claims a spawn request (POST /worker/agent-requests/:id/claim)'
);
select lives_ok(
  $$ update public.agent_message_requests set claimed_at = now() where id = gen_random_uuid() $$,
  'the API claims a message request'
);
-- Put the job back for the old-path half below.
update public.jobs set status = 'queued', claimed_at = null, finished_at = null
  where id = '00000000-0000-0000-0000-0000000000d1';

reset role;

-- Until every worker has updated, one on the old build still runs the
-- statements below as anon, and the switch keeps them working. Turn it on.
update docs.app_config set value = 'on' where key = 'worker_public_access';

set local role anon;

-- discover-repos.ts -> reconcileAgentSessions: marks sessions missing,
-- reactivates ones it sees again, and inserts ones it has just discovered.
-- The insert is the one the lockdown took away.
select lives_ok(
  $$ insert into public.agent_sessions
       (owner_id, name, provider, session_token, external_session_id, status)
     values ('00000000-0000-0000-0000-00000000aa01', 'discovered session',
             'claude_code', 'tok_test', 'ext_test', 'active') $$,
  'the worker can record a newly discovered agent session'
);
select lives_ok(
  $$ update public.agent_sessions set status = 'missing', ended_reason = 'deleted_upstream'
     where external_session_id = 'ext_test' $$,
  'the worker can mark a session that vanished upstream'
);
select lives_ok(
  $$ update public.agent_sessions set status = 'active', last_seen = now()
     where external_session_id = 'ext_test' $$,
  'the worker can reactivate a session it sees again'
);

-- run-ticket-worker.ts: claim a job, heartbeat it, finish it.
select lives_ok(
  $$ select public.claim_next_job('00000000-0000-0000-0000-00000000aa01', '0.7.8') $$,
  'the worker can claim a job'
);
select lives_ok(
  $$ update public.jobs set status = 'running' where id = '00000000-0000-0000-0000-0000000000d1' $$,
  'the worker can update the job it claimed'
);

-- tickets.ts: report progress back onto the ticket, and post its replies.
select lives_ok(
  $$ update public.tickets set cc_state = 'running' where id = '00000000-0000-0000-0000-0000000000c1' $$,
  'the worker can report progress on a ticket'
);
select lives_ok(
  $$ insert into public.ticket_messages (ticket_id, role, content)
     values ('00000000-0000-0000-0000-0000000000c1', 'assistant', 'done') $$,
  'the worker can post a ticket message'
);

-- api-keys.ts: record this machine's Claude Code version on its own key.
select lives_ok(
  $$ update public.api_keys set claude_version = '2.1.276' where key_prefix = 'nothing_matches' $$,
  'the worker can record its Claude Code version'
);

-- discover-repos.ts: presence, repos, sessions -- through the RPCs.
select lives_ok(
  $$ select public.report_worker_repos('00000000-0000-0000-0000-00000000aa01', '[]'::jsonb) $$,
  'the worker can report its repos'
);
select lives_ok(
  $$ select public.report_worker_sessions('00000000-0000-0000-0000-00000000aa01', '[]'::jsonb) $$,
  'the worker can report its sessions'
);
select lives_ok(
  $$ select public.take_repo_rescan('00000000-0000-0000-0000-00000000aa01') $$,
  'the worker can take a rescan request'
);

-- agent-sessions.ts: poll and claim spawn/message requests.
select lives_ok(
  $$ select count(*) from public.agent_spawn_requests where finished_at is null $$,
  'the worker can poll spawn requests'
);
select lives_ok(
  $$ update public.agent_spawn_requests set claimed_at = now() where id = gen_random_uuid() $$,
  'the worker can claim a spawn request'
);
select lives_ok(
  $$ update public.agent_message_requests set claimed_at = now() where id = gen_random_uuid() $$,
  'the worker can claim a message request'
);

-- vault sync: since security lockdown stage 2 the daemon reads and writes CRDT
-- snapshots through the web API with its API key, not here. On the public key
-- the table answers nothing -- which is the point, and what the daemon no
-- longer depends on.
select is(
  (select count(*)::int from docs.doc_crdt), 0,
  'the public key sees no CRDT snapshots; the daemon goes through the API'
);

reset role;
select * from finish();
rollback;
