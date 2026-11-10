# Markbase

**The AI-native markdown humans and agents write together.**

Markbase is a folder of markdown that syncs. You and your team edit the files
in the folder, in the browser, in the desktop app, or through the agents you
already run, and everyone reads one version. Comments, history and sharing sit
on top of plain `.md` files, so nothing is locked in: the folder is yours, and
it keeps working without us.

- **Use it:** [markbase.so](https://markbase.so) — sign-up is open.
- **Desktop app (macOS, Apple silicon):**
  [download the latest](https://github.com/Jarxi/markbase-releases/releases/latest/download/Markbase-arm64.dmg) ·
  [release notes](https://markbase.so/releases)
- **Docs:** [markbase.so/docs](https://markbase.so/docs) — formats, vaults,
  shared documents, working next to your code.
- **Run your own:** [SELF-HOSTING.md](./SELF-HOSTING.md) — one instance for a
  team, on Docker or Vercel, with a Supabase project you own.

## How it works

A **vault** is a set of documents in the cloud and, on each machine that
mounts it, one folder that mirrors them. A background sync keeps the two in
step, both ways, and merges concurrent edits instead of overwriting them —
git without push and pull.

- **People** write in the browser or the desktop app: comments anchored to the
  text, version history, sharing by link or by name.
- **Agents** — Claude Code, Codex, Cursor, anything that edits files — work on
  the markdown in the folder. The sync daemon holds the only credential; the
  agent needs none. There is also an HTTP API and a skill
  ([`skills/markbase`](./skills/markbase)) for agents that are not on your disk.
- **Teams** keep the vault in the repository, beside the code it describes, so
  the spec an engineer's agent builds from is the one the PM edited this
  morning.

The same build serves the hosted app and every self-hosted instance. An
instance that is not markbase.so is invite-only: the first account created on
it is the admin, and teammates join through a link from Settings.

## What is in this repository

```
apps/web/        The web app and the HTTP API (Next.js). What markbase.so and a
                 self-hosted instance both run.
apps/app/        The desktop app (Electron): the same documents, plus the sync
                 that mirrors a vault to a folder.
apps/markbase/   The `markbase` CLI (@markbase/cli): sign in, mount a vault,
                 run the sync as a background service.

packages/core/       What everything is built on
  protocol/          Isomorphic types, the API client, pure logic. Runs in a
                     browser, a server and a daemon alike.
  vault/             The local vault: watcher, lock, registry, file sync.
  flows/             Steps every client shares (sign in, mount a vault), written
                     once against an operator that asks the questions.
  node/  registry/  ui/  runner/  agent/  llm/  browser-agent/

packages/features/   Things that live in the kernel
  docs/              The collaborative document engine: CRDT, markdown,
                     comments, history, the vault's file contents. Released.
  agents/ attention/ diary/ email/ projects/ reader/ skills/ terms/ today/
                     In the repository, not in the released product. A build
                     ships them only when MARKBASE_FEATURES names them.

supabase/        Migrations and database tests. The schema is built from these.
docs/            Design notes: the shared vault, the workspace layout, how
                 features plug in.
```

The vault is core and documents are a feature, so the dependency points from
`docs` to `vault`, not the other way: the vault says what it needs from a
synced file and `docs` implements it.
`packages/core/protocol/test/package-boundary.test.ts` fails if an edge is
added back.

## Develop

You need Node.js 22 or later and a Supabase project to point at — the local
stack (`npx supabase@2 start`) is the easy one. Apply the migrations to it with
`npx supabase@2 db push`, as [SELF-HOSTING.md](./SELF-HOSTING.md) section 1
describes.

```bash
npm install            # at the repo root (npm workspaces)
npm run dev            # the web app → http://localhost:3000
```

`apps/web/.env.local` takes the same values as [`.env.example`](./.env.example):
the project's URL and publishable key, its secret key, and `APP_URL`.

```bash
npm run typecheck      # every workspace — what CI runs
npm test               # every workspace's tests
```

The CLI:

```bash
cd apps/markbase && npm run build && npm link
markbase login                       # browser sign-in, installs the sync service
markbase vault mount "Team notes" ~/Code/my-app/docs
```

The desktop app (`apps/app`): `npm run build`, then `npx electron .` for a dev
run, or `npm run dist` for a DMG. Building it from a fresh checkout has two
extra steps, in *Building the desktop app* in the self-hosting guide.

`MARKBASE_APP_URL` points the CLI at a dev server; `markbase instance <url>`
saves an instance for the CLI and the desktop app alike.

## Contributing

Pull requests are welcome. Commits need a `Signed-off-by` line (`git commit
-s`); [CONTRIBUTING.md](./CONTRIBUTING.md) says why and covers bringing code
from elsewhere.

## Licence

[Apache-2.0](./LICENSE). The licence covers the code, not the name or the
logo: [TRADEMARK.md](./TRADEMARK.md) says what you may do with those without
asking. Third-party notices are in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
