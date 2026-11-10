# Security lockdown, stage 2

> **Sequencing lives in [ROADMAP.md](ROADMAP.md), where this is R1** — the one
> item that blocks release outright. This document holds the detail: which
> grants remain, the CRDT options, and the rollout order.

Status: draft · updated 2026-09-23 · **not started, and it is the launch
blocker.** Stage 1 is applied (`20260916162448`), but two later migrations walked
part of it back: `20260916173202_public_key_grants` and
`20260920050654_worker_agent_session_insert`.

Read `dbd0a36` before concluding the direction reversed. Stage 1 revoked INSERT
on `agent_sessions` because a code map said the worker only read and updated it.
It also inserts, four frames down — `discover-repos` → `reconcileAgentSessions`.
So from 2026-09-16 every newly discovered Claude Code session was dropped (401
from PostgREST, forty-eight of them) while the daemon logged "discovered 12 local
repos, 88 sessions" as though it had worked. The re-grant corrected an
over-broad revocation that was failing silently in production; it was not a
retreat from the goal. The lesson for stage 2 is in the Rollout section: revoke
last, gate on worker version, and test the writes.
Follows: `supabase/migrations/20260916162448_security_lockdown_stage1.sql`

Stage 1 closed every table nothing legitimately used. What remains open is what
the CLI worker, desktop app and browser still reach with the **publishable
key** — the one that ships in the browser bundle and the npm package:

| Still reachable with the public key | Operations |
|---|---|
| `jobs`, `tickets`, `api_keys`, `agent_sessions`, `agent_spawn_requests`, `agent_message_requests` | select, update |
| `user_plans`, `projects` | select |
| `ticket_messages` | select, insert |
| `workers`, `worker_repos`, `worker_sessions` | select, insert, update |
| `docs.doc_crdt` | select, insert, update |
| `claim_next_job`, `reclaim_stale`, `report_worker_repos`, `report_worker_sessions`, `take_repo_rescan`, `request_repo_rescan` | execute |
| `crdt:<docId>` broadcast channels | publish, subscribe |

Anyone holding that key can read and edit **every user's** rows in those
tables, and join any document's live-editing channel if they know its id. The
worker RPCs take `p_owner_id` as an argument and trust it, so one caller can
claim another owner's jobs.

---

## Why not "give the CLI a user session"

The obvious fix — hand the CLI a Supabase session and write
`owner_id = auth.uid()` policies — is wrong here, for a reason specific to this
codebase.

**The API key carries a capability ceiling.** `/cli-auth/approve` says it
outright: *"this machine's ceiling on your documents — the security boundary.
Anything an agent on this machine does is capped here, and no header/session
trick can widen it."* Desktop sign-in gets `owner`; the CLI gets whatever
capability was picked at login, and `capabilityFor()` intersects it with the
caller's member capability through `minCapability()`.

A per-user session has no such ceiling. `auth.uid()` is the user, so a machine
deliberately capped at `commenter` would gain owner-level access to every row
that user owns. That is a regression dressed as a fix.

Keeping the ceiling in a session-based design means putting the capability in
the token's claims and reading it in every policy. That needs a signing secret
and a custom-claims auth hook — and this project has **no reachable symmetric
JWT secret** (`app.settings.jwt_secret` is unset, there is no `auth.jwks`
table; it uses the new `sb_publishable_` / `sb_secret_` key format). So that
route is not available without new infrastructure.

**Therefore: the API stays the authority.** It already computes the correct
answer, and the ceiling is already enforced there.

---

## The design

Every client keeps its API key. Nothing holds a database credential.

```
CLI worker ─┐
Desktop     ├─ Authorization: Bearer jsk_… ─→ /api/v1/*  ─→ secret key ─→ database
Browser    ─┘   (session cookie for the browser)
```

The pieces already exist:

- `authenticateAgent(req, scope)` — session cookie **or** API key, returns
  `ownerId` and the key (with `capability` and `scopes`).
- `resolveActor(req, need)` — carries the key's ceiling as `capabilityCap`.
- `capabilityFor()` / `minCapability()` / `atLeast()` — the intersection.
- `AGENT_ENDPOINTS` (`packages/docs/src/endpoints.ts`) — one declaration per
  endpoint yielding route auth, MCP tools, CLI commands and the skill doc.
- `callEndpoint()` in `apps/markbase/src/integration/call.ts` — the CLI's
  existing bearer-token client.

### New endpoints

Each replaces direct PostgREST access. All scope by the key's `ownerId`
server-side; none accepts an owner id from the caller.

| Endpoint | Replaces |
|---|---|
| `POST /api/v1/worker/claim` | `rpc/claim_next_job` (owner from the key, not an argument) |
| `POST /api/v1/worker/heartbeat` | `jobs` update |
| `POST /api/v1/worker/jobs/:id/finish` | `finishJob` |
| `GET /api/v1/worker/jobs/:id` | `jobs` select |
| `POST /api/v1/worker/repos` | `rpc/report_worker_repos`, `rpc/take_repo_rescan` |
| `POST /api/v1/worker/sessions` | `rpc/report_worker_sessions` |
| `GET /api/v1/worker/agent-requests` | `agent_spawn_requests` + `agent_message_requests` select |
| `POST /api/v1/worker/agent-requests/:id/claim` and `/finish` | their updates |
| `PATCH /api/v1/worker/claude-version` | `api_keys` update |
| `GET /api/v1/tickets/:id`, `PATCH /api/v1/tickets/:id` | `tickets` select/update |
| `POST /api/v1/tickets/:id/messages` | `ticket_messages` insert |
| `GET /api/v1/me/plan` | `user_plans` select |
| `GET /api/v1/projects/:slug` | `projects` select |

Add them to `AGENT_ENDPOINTS` with `capability: null` (account-level) and the
right scope, so the registry keeps generating auth, tools and docs.

### Then the grants go

`public_key_grants` shrinks to nothing for the worker tables: `revoke all` from
`anon` and `authenticated` on every table in the list above, and `revoke
execute` on the six RPCs. RLS policies stay as the second line of defence, not
the first — the API is the gate.

---

## Live document editing — decided and built (2026-10-28)

`docs.doc_crdt` and the `crdt:<docId>` broadcast channels were different from
the rest. They are high-frequency, they carry document content, and **three
different clients use them**: the browser (which has a real Supabase session),
the desktop app, and the CLI's vault sync (which have only an API key).

Three ways were on the table:

1. **API-mediated CRDT** — endpoints for snapshot load/save, the server does
   the broadcast. Uniform, no database credential anywhere, works for every
   client. Costs a server hop per save.
2. **Split by client** — the browser keeps Supabase Realtime with private
   channels and policies (it has a session); the daemons go through the API.
3. **Scoped tokens** — the API mints a short-lived JWT from the API key.
   **Blocked**: the project has no reachable signing secret (new
   `sb_publishable_`/`sb_secret_` keys, asymmetric signing), and a per-user
   session has no place for the key's capability ceiling anyway.

**Chosen: 1 for the table, 2 for the live channel.** Migration
`20261028100000_security_lockdown_stage2_crdt`; the client and server changes
landed with it.

- **Snapshots go through the API, for everyone.** `GET/POST /api/v1/docs/:id/crdt`
  (viewer to read, editor to write, through `requireDocCapability`, so a key's
  ceiling and a share-link guest's token both work as on every other document
  endpoint). The server reads and writes `docs.doc_crdt` with the secret key
  and **merges** each incoming snapshot into the stored one with a
  compare-and-swap on a new `version` column (`server/crdt-store.ts`,
  `logic/crdt-merge.ts`). The old upsert was last-write-wins at the row: a
  replica that had not yet received another's edits erased them from the cloud.
- **Live deltas between browsers stay on Realtime, on private channels**
  (`doc:<docId>`, `private: true`). Two policies on `realtime.messages`, both
  for `authenticated`, call `docs.crdt_topic_capability(topic)` — a
  SECURITY DEFINER function answering the same question `capabilityFor()`
  does — so a viewer may receive and an editor may send. The server publishes
  what a save added (the delta) with the secret key, over the REST broadcast
  endpoint.
- **Daemons and the desktop app poll.** They hold an API key and no JWT, so
  there is no private channel for them. `ApiCrdtTransport`
  (`logic/crdt-api.ts`) saves through the API and asks
  `GET /api/v1/docs/crdt/changes?since=&vault=` (or `&scope=shared` for the
  documents shared with the user — their Shared Vault, a follow-up) every 4 s which snapshots
  moved; a changed document is fetched and applied as an ordinary update. Its
  own saves are skipped by version. The desktop main process does the same on
  behalf of its windows (`crdt-host.ts`), which no longer open a Supabase
  connection at all. A share-link guest polls its one document.
- **Latency.** Browser↔browser is unchanged. Daemon→browser: the save debounce
  (0.8 s quiet, 5 s cap) instead of per-keystroke. Browser→daemon and
  browser→desktop window: the poll (≤4 s) plus the debounce, instead of
  milliseconds. A Realtime "something changed" nudge on a private per-owner
  channel would close that gap later; it needs nothing decided here.
- **Transition.** The public `crdt:<docId>` channel is relayed both ways by new
  clients (`LEGACY_PUBLIC_RELAY` in `crdt-supabase.ts`) and `docs.doc_crdt`
  keeps its public grants behind one switch, `docs.app_config
  'crdt_public_access'`, so the migration is safe to apply before any client
  has updated. Rollout below.

### Rollout (CRDT)

1. Apply `20261028100000_security_lockdown_stage2_crdt` (additive; the
   switch starts 'on' on a database that has CRDT rows). Deploy the web app.
   Old daemons keep working exactly as before; new browsers use the API and
   the private channel, and hear old clients over the legacy relay.
2. Release the desktop app and CLI. Each daemon that restarts on the new
   build stops touching the table.
3. Confirm every daemon has updated (the vault log says
   `change feed:` on the new build; the Supabase API logs stop showing
   `/rest/v1/doc_crdt` from the publishable key).
4. Cut over: `update docs.app_config set value = 'off' where key =
   'crdt_public_access'`. Direct reads answer nothing and direct writes are
   refused; the API is unaffected. Set it back 'on' if a daemon was missed.
5. Follow-up PR: set `LEGACY_PUBLIC_RELAY` false, drop the legacy topic,
   revoke `docs.doc_crdt` from `anon, authenticated`, drop the switch and its
   policy, and move the table into section 1 of
   `supabase/tests/security_lockdown.test.sql`.

### What the browser's session costs while it stays a database client

The session cookie is **not** `httpOnly`. `@supabase/ssr` sets
`DEFAULT_COOKIE_OPTIONS = { sameSite: "lax", httpOnly: false, … }` and nothing
here overrides it, so `document.cookie` returns the auth token and one injected
script can carry the session off the machine and replay it elsewhere — rather
than merely borrowing it for as long as the tab is open.

That is a consequence of the question above, not a separate bug. The browser
Supabase client has to *read* the session to authenticate Realtime and
PostgREST for itself, which three surfaces rely on today:

    packages/features/projects/src/ui/board.tsx        live board
    packages/features/projects/src/ui/sidebar.tsx
    packages/features/docs/src/ui/doc-crdt-pool.ts     collaborative editing

Turning `httpOnly` on blinds all three. **Decided 2026-09-25: leave it off.** It
only becomes available under option 1, where the browser stops being a database
client at all — so it is a reason to prefer 1, not a task of its own. Until
then the exposure is bounded the ordinary way: `SameSite=Lax`, and the proxy
refusing cross-site cookie writes.

---

## Rollout

The three known workers are on 0.7.8, 0.7.8 and **0.3.0**. Old versions break
the moment grants are revoked, so the order matters.

1. **Ship the endpoints.** Additive; nothing revoked. Production unaffected.
2. **Release the CLI and desktop app** that use them. Keep reading through
   PostgREST as a fallback for one version, so a half-updated machine still
   works.
3. **Gate on version.** `MIN_SPAWN_WORKER_VERSION` already exists for this;
   extend it to a minimum worker version and surface it in the agents page
   banner, which already renders an "outdated" state.
4. **Confirm every worker has updated** — `select worker_version from workers`.
   Contact the owner of the 0.3.0 machine first; it has been on an old version
   for months.
5. **Revoke.** One migration, mirroring stage 1.
6. **Tests.** Extend `security_lockdown.test.sql`: the worker tables move from
   the "still allowed" list to the locked list, the six RPCs join the blocked
   set, and the allowlist in the function check empties out.

## Risks

- **A stale client is a broken client.** Mitigated by the fallback version and
  the version gate, not by hoping.
- **Vault sync latency.** Whichever CRDT option is chosen, measure before and
  after; document sync is the most latency-sensitive path in the product.
- **The API becomes the single point of failure** for work that used to reach
  the database directly. It already is for documents; this widens the blast
  radius of an outage. The worker's existing retry/backoff (`poll-backoff.ts`)
  covers the polling path.

## Open questions

1. ~~Which CRDT option — 1, 2 or 3 above?~~ Decided 2026-10-28; see above.
2. Is the JWT signing secret available (dashboard → Settings → API)? Moot for
   the CRDT; still relevant if the worker tables want a session-based design.
3. Do we keep RLS policies per table as defence in depth after the grants are
   gone, or leave the tables grant-less and rely on the API alone?

---

## The ticket worker — built (2026-10-29)

The other half of stage 2: the worker tables and the six RPCs. Branch
`claude/security-stage2-worker-84b5ee`; migration
`20261029120000_security_lockdown_stage2_worker`. Lands after the CRDT half
(PR 67), whose test sections it was written to merge cleanly with.

### What changed

**The worker holds no database credential.** `@markbase/runner` talks to the
web API and nothing else, through `WorkerApi`
(`packages/core/protocol/src/worker-api.ts`): every request carries the
machine's key as a bearer token, and nothing in any request body names an
owner. A 5xx or a dropped connection is retried with the existing backoff; a
401/403 ends the run and the host reports it (the tray's "failed", the CLI's
exit). The CLI (`markbase start`) and the desktop ticket worker host pass only
`appUrl` and the key now; `configureSupabase` stays in the desktop's `main.ts`
for the vault daemons and the CRDT host until PR 67 removes those callers.

**Every direct access has an endpoint**, registered as `WORKER_ENDPOINTS` in
`packages/features/docs/src/logic/endpoints.ts` (`capability: null`,
`humanOnly` — plumbing, not agent tools) and served by handlers in
`packages/features/projects/src/handlers/worker.ts`:

| Endpoint | Replaces |
|---|---|
| `POST /worker/claim` → `{ job, rescan }` | `claim_next_job`, `take_repo_rescan` (and `reclaim_stale` once, with `reclaim: true`) |
| `POST /worker/heartbeat` | `jobs` + `tickets.cc_last_run` update |
| `GET /worker/jobs/:id`, `POST /worker/jobs/:id/finish` | `jobs` select / `finishJob` |
| `POST /worker/repos`, `POST /worker/sessions` | `report_worker_repos`, `report_worker_sessions` (+ `reconcileAgentSessions`, attributed to the key server-side) |
| `GET /worker/agent-requests`, `POST …/:id/claim`, `POST …/:id/finish` | `agent_spawn_requests` / `agent_message_requests` select + update; the claim answers with the project and a session id the server has already bound (spawn), or the session to resume (message), so the worker never reads `agent_sessions` or `projects` for them |
| `PATCH /worker/claude-version` | `api_keys` update, by the calling key's id |
| `GET /tickets/:id`, `PATCH /tickets/:id` (now takes the `cc_*`/PR fields, validated) | `tickets` select / update |
| `POST /tickets/:id/messages` | `ticket_messages` insert |
| `GET /me/plan` | `user_plans` select |
| `GET /projects/:slug` | `projects` select |

**The RPCs keep `p_owner_id`; the API passes the key's owner.** They were not
rewritten to read the owner themselves because the server has no session —
it calls them as the secret key's role — and because an old worker still calls
them during the transition. Instead each one starts with a guard: a public
caller (anon, authenticated) is refused with 42501 while the switch is off.

**The switch**: `docs.app_config` key `worker_public_access`, read by
`public.worker_public_access()`. Every `using (true)` policy on the twelve
tables became `using (public.worker_public_access())`; the four tables that
never had RLS (`agent_sessions`, the two request queues, `user_plans`) have it
now. One exception stays open for the browser: `tickets owner reads` lets a
signed-in user read their OWN tickets, because the board and the sidebar read
them directly and subscribe to Realtime changes on them. The grants are not
revoked yet — revoke last.

### Rollout

1. **Apply the migration.** Additive. The switch seeds `'on'` where a
   `public.workers` row exists (production), `'off'` on a fresh database.
   Nothing changes for running workers.
2. **Deploy the web app.** The worker endpoints exist.
3. **Release the CLI and the desktop app** at `MIN_WORKER_VERSION` (0.8.0).
   The Agents page banner now calls a worker below it outdated.
4. **Flip the switch** once `select owner_id, worker_version from
   public.workers` shows every row at 0.8.0 or later:
   `update docs.app_config set value = 'off' where key = 'worker_public_access';`
   Direct reads then return nothing, direct writes and RPC calls on the public
   key are refused, the API is unaffected. Rollback is the same row set back
   to `'on'`.
5. **Follow-up PR**: revoke the grants on the twelve tables and execute on the
   six RPCs from `anon, authenticated`, drop the switch, its function and the
   gated policies, move the tables into section 1 of
   `security_lockdown.test.sql`, and drop `DEFAULT_SUPABASE_*` from the CLI's
   config and `supabase-defaults.ts` from the desktop app once PR 67's vault
   and CRDT callers are gone too.

### Tests

- `supabase/tests/security_lockdown.test.sql` section 7: RLS on all twelve
  tables, no allow-everything policy; anon sees nothing and every write and
  every RPC is refused; a signed-in owner reads only their own tickets and
  nothing else; `service_role` (the API) claims, heartbeats, reports, finishes;
  the switch on restores the old path and off removes it.
- `supabase/tests/worker_writes.test.sql`: the worker's writes, run as the API
  runs them (`service_role`, switch off) and as an old worker still runs them
  (anon, switch on).
- `packages/features/projects/test/worker-handlers.test.ts`: another owner's
  key cannot claim, read, heartbeat or finish this owner's jobs, requests,
  tickets or projects; the owner passed to the data layer is always the key's.
- `packages/core/protocol/test/worker-api.test.ts`: retry on 5xx and network
  failure, fatal on 401/403, null on 404 reads and 409 claims.
