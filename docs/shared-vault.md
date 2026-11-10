# The Shared Vault

A document someone shared with you lands in a folder of yours, `~/Markbase/shared`
by default, and the vault daemon keeps it in step with the cloud like any vault.
Local agents (Claude Code, Codex, an editor) edit it as a plain file: no MCP, no
API key in the agent's environment. The daemon holds the only key. The CRDT
merges concurrent edits — "git without push and pull".

Shared documents are **not** in your own vaults; they only ever appear in the
Shared Vault. An owner cannot share a vault, only documents.

## Shape

- **A pseudo vault, id `shared`**, mounted through the same machine-wide registry
  as a real one (`{ vaultId: "shared", name: "Shared Vault", dir }`) and run by
  the same sync loop (`startVaultSync`). The web UI already used this id for its
  "Shared with me" scope; the API lists it as `GET /docs?scope=shared`.
- **Layout**: `<owner display name>/<title>.md` until you move or rename the
  file, which saves *your* path on *your* membership (`docs.members.path`) and
  never touches the owner's `documents.path`. Two owners' `Notes.md` never fight
  over a name; two of one owner's do, and get the usual id suffix.
- **Change feed**: the daemon polls `GET /docs/crdt/changes?scope=shared`
  (member and not owner, whichever vault the document sits in).
- **The list carries what you hold**: `GET /docs?scope=shared` answers each
  document's `capability`, your `path` (your filing, or the default layout),
  `member_path`, `owner_path`, `owner_name`, `has_crdt` and `vault_id`.

## What differs from an owned vault

| | Owned vault | Shared Vault |
|---|---|---|
| A new `.md` dropped in the folder | adopted as a new document | left alone — there is no owner to create it for |
| A file deleted | the document is trashed (`DELETE /docs/:id`) | you **leave the share** (`DELETE /docs/:id/membership`); the owner's document is untouched. Never `DELETE /docs/:id` (owner only; 403 is the safety net) |
| A file renamed or moved | `PATCH /docs/:id { path }` | `PATCH /docs/:id/membership { path }` — your filing only |
| A document gone from the list | deleted elsewhere → file to `.trash` | share revoked → file to `.trash` (edits and all) |
| Media | the vault's assets, up and down | **download only**, per document, through `GET /assets?doc=:id` |
| File modes | as written | viewer and commenter files are **0444** |

## Viewer and commenter shares

Your file is written read-only. An editor asks "read-only, overwrite?"; an agent's
write tool reports a permission error and says so. That is the signal *before*
the fact, and it is deliberate.

If you write anyway, the daemon keeps a **live fork**:

- The replica absorbs your edit and keeps applying the cloud's updates (merged
  three-way where they touch the same text), and writes the result to your file.
- It **never saves**: `VaultSync` in read-only mode drops every save and keeps a
  shadow of the cloud beside the replica. "Has local-only edits" is the two
  markdowns differing — which clears itself if you put the text back by hand, or
  if an editor lands the same change.
- The fork **survives restarts** (the persisted merge base is the cloud's text,
  not the fork's) and **never expires**. It is recorded in the vault index
  (`.markbase/index.json`, `fork: { since }`), with `since` carried across runs.
- If you are made an **editor**, the next list flips the replica to writable and
  one save merges the fork server-side. No manual step. The file's mode bits
  follow (`0644`). An editor demoted to viewer stops saving the same way.

The daemon tells its host through `SharedVaultHost.onForks(forks, fresh)` —
`fresh` are the forks appearing for the first time *ever*, not after every launch
— and hands it a `ForkControl` (`list`, `compare`, `discard`).

### What you see

- **Desktop**: one native notification per fork when it first appears (the app
  runs without its window). The menu bar icon says "N documents with local-only
  edits". In the window, the forked document in the Shared view carries a banner:
  **Compare** (the word-level diff of cloud vs local, both texts from the main
  process over IPC), **Discard my edits**, **Keep a copy** (saves your text as a
  new document in one of your vaults, then discards). Ask for edit access is a
  later surface.
- **CLI**: `markbase vault mount --shared [dir]` mounts it (default
  `~/Markbase/shared`); `markbase vault status` lists the forks; the service posts
  the same notification through the system notifier (`osascript` / `notify-send`).

## A read-only document nobody has opened yet

A viewer's replica may not save, so it cannot be the one that gives a document
its first CRDT. Until the owner (or an editor) has opened it once, the daemon
waits and says so in the log; an editor's share is seeded as the owner's daemon
would. `has_crdt` in the list is what tells it.

## Media

A shared document's images live in the **owner's** vault, which is not yours to
list. `GET /assets?doc=:id` gives anyone who may read the document exactly the
assets its markdown references (resolved against the owner's path with the same
code the daemon uses, `@markbase/protocol/asset-refs`). The daemon resolves each
reference twice — against the owner's path to fetch, against your path to write
— so `![d](img/d.png)` in `notes/Plan.md` arrives as `Ada/img/d.png` beside
`Ada/Plan.md`. Nothing is uploaded or deleted.

## Rollout order

1. Apply `20261029100000_shared_vault.sql` (additive: `docs.members.path`,
   nullable). The change feed's shared mode shipped with stage 2
   (`20261028100000`).
2. Deploy the web app: `GET /docs?scope=shared` gains its fields,
   `PATCH`/`DELETE /docs/:id/membership`, `GET /assets?doc=`.
3. Release the desktop app and the CLI. An older daemon never mounts `shared`,
   so nothing changes for it.
4. Mount: **Vaults → Sync Shared Documents to a Folder** in the app, the row at
   the top of "Shared with me", or `markbase vault mount --shared`.

Nothing here depends on the `crdt_public_access` switch; the Shared Vault only
ever talks to the API.

## Where the code is

- `packages/core/protocol/src/shared-vault.ts` — the id, the name, the default
  folder name, the layout.
- `packages/features/docs/src/handlers/documents.ts` — the shared list's shape,
  `docMembershipHandler`; `server/members.ts` — the data layer;
  `handlers/assets.ts` — `?doc=`.
- `packages/features/docs/src/logic/vault-sync.ts` — read-only mode and the fork.
- `packages/core/vault/src/vault-sync-run.ts` — the shared-mode rules, the fork
  bookkeeping, the per-document media pass.
- `apps/app/src/main.ts` — the host: notifications, tray, IPC;
  `packages/features/docs/src/ui/local-fork-banner.tsx` — the banner.
- `apps/markbase/src/vault.ts` — `mount --shared`, `status`.
- Tests: `packages/core/vault/test/shared-vault-scenarios.test.ts`,
  `packages/features/docs/test/vault-sync-readonly.test.ts`,
  `packages/features/docs/test/shared-vault-handlers.test.ts`,
  `supabase/tests/security_lockdown.test.sql` §7.
