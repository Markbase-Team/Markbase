# Moving auth to the gate, one feature at a time

Status: 2026-11-03 · every feature's prefix is behind the gate; the handlers of seven still read an injected `Authorize` (now `authorizedByGate`) · the `GUARDED` list is complete, the handler cleanup is the progress bar

Two channels reach one API — a browser sends a cookie, everything else sends a
bearer key — and both are resolved in one place before a request reaches any
feature. `apps/web/src/proxy.ts` is that place. This document is the order the
remaining features move into it, what "moved" means precisely, and what has to
be true before the list in that file can be deleted.

Background: `security-stage2-plan.md` for why the API is the authority at all.

---

## The target shape

Terms is the reference. Every feature ends up looking like this, and a feature
that looks like this is done:

```
packages/features/<name>/
├── markbase.json          routes: only real ones, and none under /api/admin
├── package.json           exports: ./handlers ./server ./ui
├── tsconfig.json
└── src/
    ├── handlers/          plain Request -> Response
    ├── server/            the database
    └── ui/                React, and no idea where it is running
```

No `client/` directory, no `host.ts`, no auth layer. The shape is the same
before and after — what changes is what the files are allowed to contain.

**`handlers/` may not.** No `Authorize`, no `authenticate`, no `resolveCaller`,
no injected `json`. A handler that resolves a caller has two gates, and two
gates disagree eventually. Authentication happened before the request arrived;
if a handler runs for an unauthenticated caller, that is a routing bug, caught
where routing is configured.

It **may** read who the caller is, from the one header the gate attaches:

    x-markbase-caller   JSON — { via, ownerId, email } for a session,
                        { via, ownerId, key: { id, provider, capability } } for a key

`ownerId` is whose data this request may reach, on both channels; the rest is
what a feature needs to attribute an action. Read it with `callerFromHeaders`
from `@markbase/protocol/auth` — never `request.headers.get` directly. That
name and shape have one definition, in that module, and one writer, the proxy,
which strips the whole `x-markbase-*` namespace from every incoming request
before it writes.

**Two modes.** A guarded prefix is `required` — the gate refuses a request
nobody vouched for, and the handlers take the caller for granted — or
`optional`: a credential that is offered is checked, and a bad one refused
exactly as before, but a request that offers nothing goes through with no
caller attached, and the feature decides what a stranger may do. `optional`
exists for a feature with a third way in that the gate does not know; `docs`
admits anonymous guests on a share token, per document, and `callerFromHeaders`
returning null is how its handlers learn that is the case they are in. The
header strip, CORS and the cross-site rule apply in both modes.

**`ui/` may not call `fetch`.** It goes through `api` from
`@markbase/protocol/api-client`, which the shell has already told how to
produce a credential. A `fetch("/api/…")` in a feature package works in exactly
one place: a browser tab, same origin, cookie attached for it. The desktop app
renders the same components from a local page against the live site with a key.

**One surface.** Everything under `/api/v1/<feature>`. `/api/admin` only ever
meant "authenticates in its own handlers"; with the gate moved it names
nothing. Merging the two is additive in both directions — see the terms commit
for the shape of that argument.

### What does NOT move to the gate

The gate answers *who is this*. It cannot answer *may this person touch this
particular row*, because that needs the row.

So per-resource authorization stays in the feature. `docs` is the case that
matters: a document has members with capabilities (owner > editor > commenter >
viewer), and `capabilityFor()` intersects the caller's with the API key's
ceiling. None of that can move, and none of it should.

What the gate owes those features is the ceiling itself. It rides on the caller
header as `key.capability` (null for a session, or a key with no ceiling), and
`docs` is the first feature that reads it.

---

## 2026-11-03: the prefixes moved together, the handlers did not

The route files of every unreleased feature left `apps/web` for their
packages (each manifest's `contributes.app`; the web build writes the route
stubs from it — see `appRouteStubs` in `@markbase/registry/web`). A package
cannot read the cookie session, so the move put every one of those prefixes
in `GUARDED` at once: attention, inbox, email, reader, learnings and
`admin/diaries`, agent-sessions, skills (`optional`, for the public install
script) and `admin/skills`, todos, tickets, summary, projects, worker,
`me/plan`, `admin/projects`, `admin/secrets`, and `/progress`, which joined
the proxy's matcher.

What did not change is the inside of the handlers. reader, diary, email,
attention and projects still take an injected `Authorize` / `HandlerHost`;
the package's route modules now hand them `authorizedByGate` from
`@markbase/protocol/caller` (or projects' in-package `gateHost`), which reads
the caller off the gate's header and ignores `need` — the gate decided it
from the method. Step 1 of "Doing one feature" below (deleting the parameter)
is therefore still open for those five, and `/api/admin/*` is still a second
surface for diaries, skills, projects and secrets. Both are now pure
refactors inside a package: the shell is no longer involved.

## Where every feature stands

Measured 2026-09-25, not remembered.

| Feature | Routes | Auth today | Bare `fetch` in ui | Extra work |
|---|---|---|---|---|
| **terms** | 4 | **gate** | 0 | done |
| reader | 8 | `Authorize` injected | 15 | — |
| diary | 4 | `Authorize` injected | 4 | `/api/admin/diaries` to merge |
| email | 7 | `Authorize` injected | 7 | — |
| attention | 14 | `Authorize` injected | 20 | — |
| agent-sessions | 2 | none in package | 3 | no `handlers/` layer yet |
| skills | 8 | none in package | 10 | no `handlers/`; `/api/admin/skills` to merge |
| today | 0 | — | 7 | no API of its own; ui only |
| **docs** | 16 (+4 vaults/assets) | **gate** (`optional`) | 0 | done — PRs 33–36; per-doc capability stays in the feature |
| projects | 22 | `HandlerHost` | 48 | largest; `/api/admin/projects` to merge |

"Bare `fetch`" counts call sites in each package's `ui/`, which is the size of
the client half of the work. It is mechanical but it is not nothing: projects
has 48.

---

## The order, and why

**1. reader, diary, email, attention.** They are already terms' shape — one
`handlers/` file taking an injected `Authorize`, one surface. The change is
deleting the parameter, moving the URL, adding one line to `GUARDED`. Do these
first because they are the ones that prove the pattern generalises before it
meets anything hard, and because four features of evidence is worth more than
an argument when the hard ones arrive.

diary also merges `/api/admin/diaries` into `/api/v1/learnings`, which is the
same additive merge terms did.

**2. agent-sessions, skills.** These have no `handlers/` layer at all — their
route files still hold the logic. They need the extraction first
(`refactor(docs): logic/, server/, ui/` is the precedent), and the auth move
falls out of it. Skills also merges `/api/admin/skills`.

today has no API. Its `ui/` still needs the `api` client, and that is all.

**3. docs — done (2026-10-22), out of order.** It was taken before the easy
four on purpose, to find out whether the shape survives the hardest case. It
did, with one addition to the gate rather than to the shape: share-link guests
reach `/api/v1/docs/:id` directly with `X-Share-Token`, so `/api/v1/docs` is
guarded in `optional` mode and the feature keeps deciding what a stranger may
do. The caller header grew from two values to the one JSON value above. The
vault and asset routes are served by the docs package and went in with it, as
`required`. `json`/`empty` stayed as two local helpers (status and headers, no
CORS) — the route files are the URL and nothing else.

**4. projects.** Twenty-two routes, 48 client call sites, and
`/api/admin/projects` to merge. Last because it is the largest and because by
then the pattern has survived nine features.

---

## Retiring `GUARDED`

### What it is

`proxy.ts` runs on every `/api/*` path — it has to, because the
disabled-feature 404 check covers API routes. It authenticates only some of
them. A discriminator between those two sets is therefore not optional, and
`GUARDED` is it.

### What it is not

It is not scaffolding that disappears. Four routes are deliberately, documented
public and always will be:

    /api/v1                          the discovery manifest — "without a key"
    /api/subscribe                   the landing page's mailing list
    /api/projects/lookup             resolve a project by slug; public fields
    /api/projects/:project/tickets   public project boards

and `/api/cron/*` authenticates with `CRON_SECRET`, not with a caller — the
gate would 401 it before its own check ran.

So the list is permanent. What is temporary is its **polarity**.

### The flip

Today `GUARDED` is an allowlist of protected paths, so the default is
unprotected: a new route that forgets to authenticate ships open, silently.
That is the wrong default, and it was chosen deliberately — the alternative
changes the behaviour of 110 routes in one commit, and no test in this
repository covers their auth.

The end state inverts it:

```ts
const PUBLIC = [
  "/api/v1",                       // exact match only, not a prefix
  "/api/subscribe",
  "/api/projects/lookup",
  "/api/cron",                     // CRON_SECRET, checked in the handler
];
```

and everything else is guarded. A new route is protected by default, and making
one public is a visible edit to a list of four.

Note `/api/v1` must match exactly — as a prefix it would exempt the entire API.
`/api/projects/:project/tickets` needs a pattern, not a prefix, or it exempts
every project route.

### Preconditions

1. Every feature above has moved. Until then the flip double-authenticates the
   ones that have not: a wasted lookup on every request, and two places that
   can disagree about a refusal.
2. The shell's own routes are accounted for — `v1/secrets` (2) plus
   `admin/secrets` (3), `v1/keys`, `v1/me`, `v1/todos` (3), `v1/worker`,
   `v1/repos`, `admin/api-keys` (2), `auth`. These belong to no feature
   package. They are guarded the same way; they just have no manifest to move.
   (`v1/vaults` and `v1/assets` turned out to be docs' — their handlers live in
   that package — and moved with it.)
3. `/api/cron/*` is in `PUBLIC` **before** the flip, not after. Getting this
   wrong silently stops the crons, and a cron that does not run reports nothing.
4. The cross-site write rule starts applying to every cookie-authenticated
   write in the app. That is the point, and it is also the one change that can
   break a legitimate caller. Check for cross-origin POSTs first.

### Then `protocol/src/caller.ts` goes

`Authorize`, `Authorized`, `Refused` and `CallerScope` exist so a handler can
declare what it needs from its host. A handler that declares nothing needs
none of them. The file carries the remaining importers in its header; when that
list empties, delete the file. `@markbase/node/caller` keeps `resolveCaller`,
which is the only implementation and the only thing the gate calls.

---

## Doing one feature

1. Delete the `Authorize` parameter from every handler, and the `json`
   injection with it. Handlers become plain objects of `Request -> Response`.
2. Move the routes to `/api/v1/<feature>/…` and delete the `/api/admin` copies.
   Route files become the URL and nothing else — five or six lines.
3. Point the feature's `ui/` at `api` from `@markbase/protocol/api-client` and
   remove every `fetch`.
4. Add the prefix to `GUARDED`.
5. Update `markbase.json` `routes`, the `/api/v1` discovery manifest, and any
   curl in `V1-TEST-PLAN.md`.
6. Remove the feature from the header of `protocol/src/caller.ts`.

### Before pushing

- `npm run typecheck && npm test && npm run build` — the build matters on its
  own here: deleting a route leaves stale entries in `.next/types` that only a
  rebuild clears, and the typecheck fails on them until it runs.
- `grep -rn "api/admin/<feature>"` across the repo, including `docs/`.
- `grep -rn "fetch(" packages/features/<feature>/src/ui`.
- A test in `apps/web/test/` for anything the gate now decides for this feature
  that it did not decide before.
