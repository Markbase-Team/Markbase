---
name: monorepo-single-feature-structure
description: The file shape every feature package in this monorepo has to end up with — packages/features/<name>/ with handlers/, server/ and ui/, and the rules about what each layer may contain. Use this whenever adding a feature package, moving a feature out of apps/web into packages/features, deciding where a new file belongs inside one, reviewing a feature package, or answering "where does this go" / "why is there no client layer" / "can this handler check auth". Also use it when touching auth in a feature's handlers or a fetch in a feature's ui, since both are things this shape forbids and the reason why is here.
---

# What a feature package looks like

Ten features live in `packages/features/`. They are consumed by three shells —
the Next app (`apps/web`), the Electron app (`apps/app`), and the CLI
(`apps/markbase`) — and the whole point of the shape below is that a feature
cannot tell which one is rendering it or which one is serving it.

`packages/features/terms` is the reference implementation: the smallest one,
the first fully migrated one, and the answer whenever something here is
ambiguous. Nine files, 690 lines, and a complete feature.

## The tree

This is `packages/features/terms` exactly as it stands, line counts included,
because a real one is worth more than a template — it shows how small a
complete feature is.

```
packages/features/terms/
├── markbase.json              19   id, sidebar entry, routes
├── package.json               25   exports: ./handlers ./server ./ui
├── tsconfig.json              18
└── src/
    ├── handlers/
    │   ├── index.ts            6   re-exports the handler objects, nothing else
    │   └── terms.ts          148   plain Request -> Response
    ├── server/
    │   └── index.ts          103   supabase queries and the row types
    └── ui/
        ├── index.ts            2
        ├── terms-client.tsx  190   the component, no props
        └── use-terms.ts      179   state + actions, calls the shared api client
                              ───
                              690
```

As a template:

```
packages/features/<name>/
├── markbase.json
├── package.json               exports: ./handlers ./server ./ui
├── tsconfig.json
└── src/
    ├── handlers/
    │   ├── index.ts
    │   └── <name>.ts
    ├── server/
    │   └── index.ts
    └── ui/
        ├── index.ts
        ├── <name>-client.tsx
        └── use-<name>.ts
```

Nine files, three directories, three exports.

A feature too big for one file per layer adds files INSIDE these three rather
than adding a fourth. `docs` is the largest — 9 files in `handlers/`, 17 in
`server/`, 62 in `ui/` — and it is the only one with a fourth directory:
`logic/`, 32 files of CRDT, markdown and diffing that is genuinely neither
HTTP nor database nor React. That is the bar for a new top-level concept: a
body of logic that is none of the three, not a place for things that were
awkward to file.

Notably absent, and deliberately:

- **no `client/`** — the thing that would go in it is five one-line functions
  wrapping `api.json`, and they belong in `use-<name>.ts` where they are used
- **no `host.ts`** — nothing is injected any more, so there is no host contract
- **no `auth.ts`** — the gate authenticates before the package is reached

## The three layers

The tree is the easy half. What keeps it from rotting is that each layer is
defined by what it is NOT allowed to know.

### `handlers/` — the business, and no idea who is asking

Route handlers as plain objects of `(req: Request) => Promise<Response>`, taking
the id as a second argument where the path has one.

**It does not authenticate.** No `Authorize`, no `resolveCaller`, no
`authenticate`, no injected `json` writer. Authentication happens once, in
`apps/web/src/proxy.ts`, before the request arrives. A handler that also
resolves a caller means two gates, and two gates disagree eventually — and the
duplication hides which one is actually load-bearing. If a handler runs for an
unauthenticated caller, that is a routing mistake, and it gets caught where
routing is configured rather than in forty handler bodies.

The gate attaches who the caller is as headers. Read them through
`@markbase/protocol/auth`, never `request.headers.get` — the names have one
definition and one writer, and a feature reaching for the raw string is a
feature that can be handed a forged one.

**What does stay here**: authorization that needs the resource. The gate
answers *who is this*; it cannot answer *may this person touch this row*,
because that needs the row. `docs` keeps its per-document capability check for
exactly this reason, and intersects it with the API key's ceiling.

`termsHandler.GET` is the shape at its purest — its full signature is
`async (): Promise<Response>`, because it does not even need the request.

### `server/` — the database, and no idea it is in a web app

Supabase queries and the row types. No `Request`, no `Response`, no HTTP status
codes. This layer is usually already clean, because it was never tempted.

### `ui/` — React, and no idea where it is running

**It does not call `fetch`.** It goes through `api` from
`@markbase/protocol/api-client`:

```ts
import { api } from "@markbase/protocol/api-client";
const BASE = "/api/v1/<name>";

const rows = await api.json<{ rows: Row[] }>(BASE);
await api.request(`${BASE}/${id}`, { method: "DELETE" });
```

A bare `fetch("/api/…")` works in exactly one place: a browser tab, same
origin, with the cookie attached for it. The desktop app renders these same
components from a local page against the live site with a bearer key, and the
CLI has no cookie jar at all. Each shell configures `api` once at startup —
`configureBaseUrl` and `configureAuth` — and the feature never learns which
credential it got.

**No `next/*` imports.** A feature that imports `next/navigation` is pinned to
one shell forever. The port is `@markbase/ui/navigation`.

## Three rules a test already enforces

`packages/core/protocol/test/package-boundary.test.ts` fails the build on all
three, so these are checked rather than hoped for:

- no package imports `next/*`
- no feature imports another feature — shared things move to `packages/core/`
  (`ui` and `llm` are shared capabilities, not features)
- no `"use client"` file imports a node-only package, which is what stops a
  service-role database client reaching a browser bundle

The third is the real reason `handlers/`+`server/` and `ui/` are separate
directories rather than a matter of taste: `server/` imports the Supabase
service client, and a single module holding both would put it in the bundle.

## One API surface

Everything under `/api/v1/<name>`. Nothing under `/api/admin`.

`/api/admin` only ever meant "this one authenticates in its own handlers". With
the gate moved it names nothing, so features that still have both surfaces
merge them. The merge is additive in both directions — the agent-facing rows
gain whatever the app's richer shape carried, and the app gains any parameter
the agent surface accepted. Read the terms merge commit before doing one.

After moving, `markbase.json`'s `routes` lists only paths that exist, and the
prefix goes into `GUARDED` in `apps/web/src/proxy.ts`.

## Checking a package

These are cheap and they are the actual definition of done:

```bash
F=packages/features/<name>

# Auth in the handlers. Both styles: the injected `Authorize` and the
# HandlerHost's `authenticate`. The trailing filter drops comment lines, which
# are where the words legitimately survive after a migration.
grep -rnE '\b(Authorize|resolveCaller|authenticate)\b' $F/src/handlers/ | grep -vE ':[0-9]+: *(\*|//)'

# Bare fetch in the UI. Anchored so it does not match `api.request(` etc.
grep -rnE '(^|[^.\w])fetch\(' $F/src/ui/ | grep -vE ':[0-9]+: *(\*|//)'

# Real imports only — plain "next/" matches eslint directives and prose.
grep -rnE 'from "next/|require\("next/' $F/src/

grep -rn "api/admin" $F | grep -vE ':[0-9]+: *(\*|//)'
```

All four are empty for terms. Use it as the control: if a check looks noisy,
run it against `packages/features/terms` first to find out whether the
pattern is wrong before concluding the package is. The loose versions of these
patterns produce false positives on every feature, which is why each is
filtered: `next/` matches `eslint-disable-next-line`, `authenticate` matches the
comment explaining that a handler no longer authenticates, and `api/admin`
matches the line left behind recording that the surface was merged away.

When a feature has just moved, also run the build, not only typecheck —
deleting a route leaves stale entries in `apps/web/.next/types` that only a
rebuild clears, and typecheck fails on them until it runs.

## How a shell consumes one

The web app holds no route file for a feature. The feature declares its route
files in `markbase.json`, as paths under Next's `app/` directory:

```json
"contributes": {
  "app": [
    "dashboard/<name>/page",
    "api/v1/<name>/route",
    "api/v1/<name>/[id]/route",
    { "path": "api/cron/<name>/route", "maxDuration": 300 }
  ]
}
```

and keeps them under `src/app/` with the same shape, exported as
`"./app/*/route"`, `"./app/*/page"` and `"./app/*/layout"`. The web build
(`apps/web/scripts/gen-feature-slots.ts`) writes one stub per entry into
gitignored route groups — `src/app/dashboard/(features)/…` under the
dashboard layout, `src/app/(features)/…` under the root — so a build that
leaves the feature out never names the package. Segment config
(`maxDuration`, `dynamic`, a page `title`) goes in the manifest entry: Next
reads it off the route file itself and would not see it through a re-export.

The route module is the URL and nothing else, and it does not authenticate:
the prefix is in the proxy's `GUARDED` list and the gate has already attached
the caller.

```ts
// packages/features/<name>/src/app/api/v1/<name>/route.ts
import { somethingHandler } from "../../../../handlers";
export const GET = somethingHandler.GET;
export const POST = somethingHandler.POST;
```

The page is the component and nothing else. It is rendered by the shell with
a `host` (`@markbase/ui/page-host`) — viewer, redirect, notFound,
requireFeature, routes, Link — which is the whole of what a server page may
need from the shell; a page that needs none of it ignores the prop:

```tsx
// packages/features/<name>/src/app/dashboard/<name>/page.tsx
import type { FeaturePageProps } from "@markbase/ui/page-host";
import { SomethingClient } from "../../../ui";
export default function Page(_: FeaturePageProps) {
  return <SomethingClient />;
}
```

A feature that composes another names it in the manifest's `requires`;
`enabledFeatures` refuses a build with the dependant and not the dependency,
and the boundary test allows exactly the declared edges (today: attention →
email). An undeclared cross-feature import is still a failure.

The desktop app mounts the kernel and Documents only; a feature's pages reach
it through its package when it is released.

## Where the rest of this is written down

- `docs/auth-gate-migration.md` — which features have moved, the order for the
  rest, and what retires the `GUARDED` list
- `docs/client-architecture-plan.md` — why there are three shells at all
- `packages/features/terms` — the thing itself
