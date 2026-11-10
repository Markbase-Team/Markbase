# One product, three clients

> **Sequencing lives in [ROADMAP.md](ROADMAP.md).** Steps 1–2 here are part of
> R0 (done). Step 4 — moving both node hosts onto the API — is R1's endpoints.

Status: in progress · updated 2026-09-23 · step 1 done, step 2 substantially done
(`@markbase/flows` exists, asking via `Operator` — see the note at "The one
interface that makes flows shareable" — with 81 tests passing), step 3
unblocked. Steps 4-6 open; step 4 waits on `docs/security-stage2-plan.md`.
Related: `docs/security-stage2-plan.md`, `docs/plugin-system-plan.md`

Markbase ships to three places:

| Client | Has a UI | Has local files | Runs agents |
|---|---|---|---|
| **Desktop** (dmg, Electron) | yes | yes | yes |
| **Headless** (CLI on a server, CI, a spare box) | no | yes | yes |
| **Browser** | yes | no | no (asks a runner to) |

The goal: every feature works everywhere it *can* work, and the only real
difference is the presence of a screen. Headless is not a lesser client — it is
the same client without a window.

---

## Where we actually are

The low layer is already shared, and since 2026-09-21 it is four packages rather
than one. Both node hosts draw on `@markbase/vault` (`startVaultSync`,
`checkMount`, `readMountedVaults`, `readVaultMarker`, `markbaseHome`,
`migrateHome`, `MountedVault`) and `@markbase/node` (`awaitDeviceAuth`,
`detectClaudeVersion`), with `@markbase/protocol` underneath both.

(`writeMountedVaults` is gone: replacing the whole list from a stale read is how
a concurrent mount got erased, so every writer goes through `updateMountedVaults`
instead.)

What is **not** shared is everything built on top of them.

| Flow | Desktop | CLI |
|---|---|---|
| Sign in | `signIn`, `offerSignIn`, `readApiKey`, `storeApiKey`, `readOwnKey`, `signedIn` | `runLogin`, `browserLogin`, `ensureAuthenticated` |
| Mount / add a vault | `addVault`, `mountVaultToFolder`, `chooseVaultFolder`, `offerFirstMount`, `offerRepoint` | `runVault`, `fetchVaults`, `findVault` |
| Start / stop sync | `startVault`, `stopVault`, `stopAll`, `reconcileVaults`, `reclaimVaultsAtDefaultHome` | `startVaultSyncDaemons`, `runVaultSync` |
| Mirror to a folder | — | `runMirror`, `syncMirror` |
| Claim and run jobs | — | `runTicketWorker` |
| Speak the API | — | `AGENT_ENDPOINTS`, `callEndpoint` |

Two asymmetries matter most:

- **The desktop cannot claim jobs.** `runTicketWorker` is CLI-only, which is why
  closing the daemon leaves dispatched work queued forever.
- **The desktop never uses the API.** It reaches the database directly with the
  publishable key, so it misses everything the endpoint registry gives the CLI:
  auth, capability, MCP tools, generated docs.

The duplication is not accidental. Each host wrote its own version of the same
flow because the flows ask questions — *which folder? overwrite? sign in
again?* — and Electron asks with a dialog while the CLI asks on stdin. The
question-asking is the only genuinely different part.

---

## The shape to aim for

Six packages, each declaring what it needs from its environment. Hosts become
thin.

```
@markbase/protocol   isomorphic   types · endpoint registry · API client · connection identity
@markbase/docs       isomorphic   CRDT · markdown · editor model
@markbase/vault      node         watcher · lock · materialise · sync engine
@markbase/agent      node         provider-neutral agent execution (today's agent-chat)
@markbase/runner     node         claim · heartbeat · execute · report · discover repos
@markbase/flows      node         sign in · mount · reconcile · mirror — asks via Operator
```

```
apps/app        Electron: windows, menus, IPC bridges, pty, tray        ~150 lines of host
apps/markbase   argv parsing, stdio prompts, service install            ~125 lines of host
apps/web        routes, React, server handlers
```

### The one interface that makes flows shareable

> Sketched here as `HostPrompt`; **shipped as `Operator`**
> (`packages/flows/src/operator.ts`). Not merely renamed — the shipped version
> takes request objects rather than loose arguments, and adds two things the
> sketch lacked: `OperatorNeedsPersonError`, which carries the question so a
> headless failure says what it could not answer, and an `UnattendedPolicy`
> that denies by default. Three implementations exist: `unattendedOperator` and
> `terminalOperator` both in `packages/flows`, and `dialogOperator` in
> `apps/app` — only the Electron one has to live in a host, because only it
> needs `dialog.showMessageBox`.

The flows are identical except for how they ask. So inject that:

```ts
// As shipped — packages/flows/src/operator.ts
export interface Operator {
  /** May I do this thing that changes or destroys something? */
  approve(req: ApprovalRequest): Promise<boolean>;
  /** Which of these do you want? Values Markbase already knows about. */
  chooseOption<T>(req: OptionRequest<T>): Promise<T | null>;
  /** Where on disk? Asks the operating system, not a list. */
  chooseFolder(req: FolderRequest): Promise<string | null>;
  /** Here is what happened. No answer wanted. */
  reportEvent(e: OperatorEvent): void;
  /** Here is how far along the long-running thing is. */
  reportProgress(p: OperatorProgress): void;
}

/** Thrown when a flow needs an answer only a person can give and there is none.
 *  Carries the question, so the log says what was being asked. */
export class OperatorNeedsPersonError extends Error {
  readonly question: string;
}
```

- Electron implements it with `dialog.showMessageBox` and the folder picker.
- The CLI implements it with `readline` and stdout.
- **Headless implements it with a policy**, not a person — `unattendedOperator`.
  `approve` answers from `UnattendedPolicy.approvals`, which **denies by
  default** because nobody is watching. `chooseOption` answers from a keyed
  table, comparing as text because policy comes from a config file where every
  answer is a string. `reportEvent` writes to the log, defaulting to stderr —
  never to nowhere.

  **Correction to an earlier draft:** `chooseFolder` does *not* return null. It
  throws `OperatorNeedsPersonError`, deliberately — a path that does not exist,
  or belongs to another vault, fails much later and much less clearly. That is
  the "fails loudly instead of hanging" rule actually being applied, rather than
  described and then contradicted.

Then `mountVault(ctx, host)` is written once and both hosts call it. This is
the single biggest de-duplication available: roughly 15 Electron functions and
3 CLI commands collapse into one set.

### One transport, not three

Today: the browser uses a session, the CLI uses an API key against `/api/v1`
*and* the database, the desktop uses the publishable key against the database.
Target: **everyone speaks `/api/v1`**, with the browser's session or the
client's connection key. `@markbase/protocol` owns that client, and the
endpoint registry stays the single declaration that generates routes, auth,
MCP tools and docs. This is the same work as stage 2 — the refactor and the
lockdown are one job, not two.

### Identity is the connection, not the machine

A connection (an `api_keys` row) already carries provider, capability and name.
Each host registers its own, so Claude Code and Codex on one machine are two
identities, and a laptop and a server are two more. Presence, discovered repos
and sessions key on the connection; jobs may target one or leave it null for
any runner. See `docs/security-stage2-plan.md`.

---

## What stays host-specific, forever

- **Electron**: windows, menus, tray, the pty, IPC bridges, file pickers,
  `open`-ing a terminal, onboarding HTML.
- **CLI**: argv parsing, stdio prompts, launchd/systemd service files, update.
- **Web**: routes, React, SSR, the editor's DOM.

Everything else belongs in a package. The test: *if a headless box needs it,
it cannot live in `apps/app`*.

---

## Sequence

Each step ships on its own and leaves the product working.

1. **Split `core`.** ✅ Done 2026-09-21. It was 49 files, 23 touching node
   builtins, exported through a `"./*"` wildcard so anything was importable
   anywhere. Split into **four** packages, not three: `@markbase/protocol`
   (isomorphic), `@markbase/node` (node, but imported by `apps/web` — api-keys,
   repos, the Claude probe), `@markbase/vault` and `@markbase/runner`. The fourth
   package exists because `agent-sessions`, `api-keys` and `repos` are node-bound
   yet used by web server routes; filing them under `runner` would have made the
   web app depend on the job runner. Explicit exports maps replaced the wildcard.

   The `core` ↔ `docs` cycle is broken: `crdt-supabase` moved to `@markbase/docs`
   (it implements that package's own `DocStore`/`DocPubSub`) and `VaultDocRef`
   moved to protocol, so the graph is `protocol ← docs ← vault/runner`.

   **Still outstanding:** `api-keys` stays node-bound, because porting its sha256
   hashing to `crypto.subtle` makes `hashToken` async — a security change, not a
   file move.

   **Done since this was written:** the rule barring node subpaths from
   `"use client"` files. It exists as a test rather than a lint rule —
   `packages/protocol/test/package-boundary.test.ts` asserts that no
   `"use client"` file imports a node-only package. ESLint conditions on paths,
   and `"use client"` is a string inside the file, so a test was the honest tool.
2. **Extract `@markbase/flows` with `Operator`.** ✅ Substantially done — the
   package exists and is isomorphic, with three flows already moved
   (`mount-vault`, `sign-in`, `reconcile-vaults`), the `Operator` interface
   and 81 tests. Remaining: move the vault and auth
   flows out of `main.ts` and the CLI commands into one implementation. The
   hosts keep their prompt implementations and nothing else.
3. **Give the desktop the runner.** `startRunner(ctx)` from `@markbase/runner`,
   the same call the CLI makes. Requires connection identity first, or the two
   processes fight over one presence row.
4. **Move both node hosts onto the API** (stage 2's endpoints), then revoke the
   publishable key.
5. **Headless parity pass.** A device-code login (today's loopback flow cannot
   complete on a remote box), a policy-driven `Operator`, and the agent chat
   surface exposed over the API/MCP rather than only in the panel.
6. **Conformance tests.** One suite, run against each host: sign in, mount a
   vault, sync a document, claim a job, report a result. A host that cannot
   pass it is not a client.

## Risks

- **`main.ts` is 1953 lines and the app is shipped software.** Move flows one
  at a time, each behind its own commit, with the app launched and exercised
  after each.
- **Flows that quietly depend on being interactive** will surface as headless
  hangs. That is what the policy `Operator` and the conformance suite are
  for.
- **Two runners on one machine** is only safe once presence is per connection.
  Do not ship step 3 before that.
- **Package churn touches every import in the repo.** Do the split (step 1) in
  one mechanical commit, not spread across feature work.
