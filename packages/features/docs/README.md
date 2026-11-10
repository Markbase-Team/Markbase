# Collaborative documents — agent-editable docs

`@markbase/docs` is the engine behind "Google Docs for markdown": documents that
humans and AI agents edit **through the same operation-based API**, in real time,
with attribution, comments, version history, and shareable review links.

This document explains the approach and the HTTP API. The engine is
transport-agnostic and headless (runs identically on client and server); the
HTTP surface lives in `apps/web/src/app/api/v1/docs`.

---

## Design in one page

**1. Markdown is the source of truth.** Every document keeps a canonical
markdown string (`content`). The editing model is a ProseMirror/TipTap document
(`doc_json`) derived from that markdown, and it serializes straight back
(`markdownToDoc` / `docToMarkdown`). Markdown is what agents read and write, what
diffs and history are computed against, and what survives schema changes.

**2. One edit path for humans and agents.** Every change — a keystroke in the
browser, an agent's anchored edit, a whole-document markdown replace, a restore —
becomes ProseMirror **steps** and flows through a single authority function,
`receiveSteps`. Humans and agents differ only by the `author` attached to the
change, never by code path. There is one place where edits converge, so there is
one place to reason about correctness.

**3. Operation-based collaboration (op-log), not (yet) a CRDT.** The server is
the authority. It stores an append-only log of step batches and accepts a batch
only if the client's `version` matches the server's head (**compare-and-set**);
otherwise it returns `409 conflict` and the client catches up and retries. This
is simple, attributable, and diffable. It is deliberately swappable for a CRDT
(Yjs) later without changing the public API — the API speaks *documents and
versions*, not *CRDT internals*.

**4. Agents edit by quoting, not by position.** An agent should not have to
track character offsets. The agent endpoint takes `{ quote, insert }` — "replace
the text matching `quote` with `insert`". The server resolves the quote to a
range against the current document and builds the steps itself
(`anchoredEditToSteps`). Positions are the server's problem, not the agent's.

**5. Capabilities, inherited.** Access is a capability, highest-wins:
`owner > editor > commenter > viewer`. A signed-in user gets their membership
capability. **An agent acts as its API key's owner and inherits that user's
capability on the doc.** A guest with a share-link token gets the link's
capability with no account.

**6. Comments are sidecar anchors.** Comments live beside the document, each
anchored to a quoted range at a version, so they survive edits and never
entangle the document content itself.

---

## Minimal steps for markdown & agent saves

Not every edit arrives as fine-grained operations. A markdown-mode save and an
agent's `POST /content` hand over a whole *document*, not steps. Rather than
commit that as one giant `ReplaceStep(0, size, entire-doc)` — which stores the
whole document and clobbers unchanged regions — `docReplaceSteps` diffs the
current document against the target with ProseMirror's `findDiffStart` /
`findDiffEnd` and emits a single `ReplaceStep` over **only the changed span** —
exactly the surgical edit a human's transaction produces.

- A one-line change becomes `replace 31–41 "was CHANGED"`, not a whole-document step.
- Identical input produces **zero** steps (no spurious version bump).
- Restore uses the same path, so reverting to a past version is a minimal edit,
  not a full-body swap.

This keeps the op log small, makes history read like real edits, and means the
stored step matches what the version diff highlights.

---

## Data model (`docs` schema)

| table | purpose |
|---|---|
| `documents` | one row per doc: `title`, `content` (markdown), `doc_json` (head), `version`, `base_doc`, `owner_id` |
| `steps` | append-only log; one row per save-batch: `from_version`, `to_version`, `steps[]`, author, `added`/`removed`, `session_id` |
| `comments` | sidecar comments: anchored `quoted_text` + range + version, threaded via `parent_id`, `resolved` |
| `members` | per-user capability grants |
| `links` | share links: `token`, `mode` (member/guest), `capability` |

**Reconstruction.** `base_doc` is the document at version 0; the head `doc_json`
is the document at `version`. Any past version is rebuilt by replaying `steps`
from `base_doc`. History is grouped into human-meaningful *versions* by
`session_id` (one editing session = one version), and diffs are **word-level**
over the rendered text, not raw step counts.

**Schema evolution.** Because markdown is canonical, a change to the editor
schema (node/mark names) is migrated by re-deriving `doc_json` from each doc's
`content` — content-preserving, no data loss. (Docs predating a schema change
otherwise fail to load with `Unknown node type: …`, for humans *and* agents.)

---

## Authentication

All `/api/v1/docs` endpoints share one auth model. Base URL:
`https://markbase.so` (prod) or `http://localhost:3000` (dev).

**Agents & users — API key** (this is the same key the `record-learning` skill
uses, `$MARKBASE_API_KEY`):

```
Authorization: Bearer <api_key>
# or
X-Api-Key: <api_key>
```

Keys carry a scope — `read` or `write` — and are owned by a user; the agent
inherits that user's capability on each doc.

**Guests — share token** (no account), for reviewers following a link:

```
X-Share-Token: <link_token>
X-Guest-Name: Ada            # optional, labels their comments
```

**Capabilities** required per endpoint are listed below. They nest:
`owner ⊃ editor ⊃ commenter ⊃ viewer`.

**Conventions.** Every response is JSON with CORS headers; `OPTIONS` preflight is
supported on every route. Errors are `{ "error": "<message>" }` with an HTTP
status. A version conflict is `409 { "error": "conflict", "serverVersion": N }`.

---

## Capability matrix

Which capability can call each endpoint. Capabilities nest —
`owner ⊃ editor ⊃ commenter ⊃ viewer` — so a ✓ means "this capability **or
higher**". The collection endpoints (`GET`/`POST /api/v1/docs`) aren't
doc-scoped; they just need a signed-in user (not a guest).

| Endpoint | Viewer | Commenter | Editor | Owner |
| --- | --- | --- | --- | --- |
| `GET /docs/:id` | ✓ | ✓ | ✓ | ✓ |
| `GET /docs/:id/steps?since=N` | ✓ | ✓ | ✓ | ✓ |
| `GET /docs/:id/at` | ✓ | ✓ | ✓ | ✓ |
| `GET /docs/:id/diff` | ✓ | ✓ | ✓ | ✓ |
| `GET /docs/:id/history` | ✓ | ✓ | ✓ | ✓ |
| `GET /docs/:id/comments` | ✓ | ✓ | ✓ | ✓ |
| `POST /docs/:id/comments` | ✗ | ✓ | ✓ | ✓ |
| `PATCH /docs/:id/comments/:cid` | ✗ | ✓ | ✓ | ✓ |
| `POST /docs/:id/edits` | ✗ | ✗ | ✓ | ✓ |
| `POST /docs/:id/content` | ✗ | ✗ | ✓ | ✓ |
| `POST /docs/:id/steps` | ✗ | ✗ | ✓ | ✓ |
| `POST /docs/:id/restore` | ✗ | ✗ | ✓ | ✓ |
| `PATCH /docs/:id` (rename) | ✗ | ✗ | ✓ | ✓ |
| `DELETE /docs/:id` | ✗ | ✗ | ✗ | ✓ |
| `GET /docs/:id/links` | ✗ | ✗ | ✗ | ✓ |
| `POST /docs/:id/links` | ✗ | ✗ | ✗ | ✓ |
| `DELETE /docs/:id/links/:linkId` | ✗ | ✗ | ✗ | ✓ |

---

## HTTP API

### Documents

#### `GET /api/v1/docs`
List docs the caller can see (owned + member of). Requires a **user** (not a
guest); scope `read`.
```json
{ "docs": [ { "id", "title", "version", "owner_id", "created_at", "updated_at" } ] }
```
`doc_json` is omitted from the list.

#### `POST /api/v1/docs`
Create a doc. Scope `write`.
```json
// body
{ "title": "My doc", "content": "# optional starting markdown" }
// 201
{ "doc": { "id", "title", "version", "doc_json", ... } }
```

#### `GET /api/v1/docs/:id` — capability `viewer`
```json
{ "doc": { "id", "title", "content", "doc_json", "version", ... }, "capability": "editor" }
```

#### `PATCH /api/v1/docs/:id` — capability `editor`
Rename. Body `{ "title": "New title" }` → `{ "ok": true }`. (Titles are normally
derived from the first heading; this is an explicit override.)

#### `DELETE /api/v1/docs/:id` — capability `owner`
→ `{ "ok": true }`.

### Editing

#### `POST /api/v1/docs/:id/edits` — capability `editor`  ⭐ the agent path
Replace the text matching `quote` with `insert`. The server resolves the anchor
and builds the steps.
```json
// body
{ "quote": "the old sentence", "insert": "the new sentence" }
// 200
{ "version": 42 }
```
- `422 { "error": "Anchor not found" }` — `quote` doesn't match the current text.
- `409 { "error": "conflict", "serverVersion": N }` — someone edited concurrently; re-read and retry.

`quote` matches the document's **visible text** (no markdown syntax). `insert`
is **markdown with structure preserved**: inline markup (`**bold**`, links)
merges into the block, and block markup (headings, lists, blockquotes, multiple
paragraphs) is inserted as real nodes. To **add** rather than replace, quote an
anchor line and repeat it at the start of `insert` (e.g. quote `"Summary"`,
insert `"Summary\n\n## Details\n\n- a\n- b"`) — the repeated line merges and the
rest lands as new blocks after it.

There is **no whole-document replace endpoint** — every change goes through
`/edits`. Create a doc with `POST /docs` (seed the first version with `content`);
to rewrite everything, quote the entire current `content` and insert the new
document in one `/edits` call.

#### `POST /api/v1/docs/:id/steps` — capability `editor`
Low-level: submit ProseMirror steps directly (used by the browser editor).
```json
// body
{ "version": 42, "steps": [ /* StepJSON[] */ ], "sessionId": "optional-uuid" }
// 200 → { "version": 43 }   |  409 { "error": "conflict", "serverVersion": N }
```

#### `GET /api/v1/docs/:id/steps?since=N` — capability `viewer`
Catch up: steps committed after version `N`.
```json
{ "version": 43, "steps": [ /* StepJSON[] */ ] }
```

### History

#### `GET /api/v1/docs/:id/history` — capability `viewer`
Revisions grouped by editing session, with author and `+added/−removed` counts.
```json
{ "version": 43, "revisions": [ { "from_version", "to_version", "author", "added", "removed", "session_id" } ] }
```

#### `GET /api/v1/docs/:id/at?version=N` — capability `viewer`
The document as of a version. → `{ "doc_json", "version" }`.

#### `GET /api/v1/docs/:id/diff?from=A&to=B` — capability `viewer`
Word-level semantic diff between two versions (`A ≤ B`).
```json
{ "segments": [ { "value": "text", "added"?: true, "removed"?: true } ] }
```

#### `POST /api/v1/docs/:id/restore` — capability `editor`
Restore a past version as a new edit on top of head (append-only; history is
preserved). Body `{ "version": N }` → `{ "version": 44 }`.

### Comments

#### `GET /api/v1/docs/:id/comments` — capability `viewer`
→ `{ "comments": [ … ] }`.

#### `POST /api/v1/docs/:id/comments` — capability `commenter`
Agents can comment on the same endpoint (their key's owner is the author);
guests comment via the share token.
```json
// body
{
  "body": "markdown comment",     // required
  "parentId": "uuid",             // optional — reply
  "quotedText": "anchored text",  // optional
  "from": 12, "to": 20,           // optional — anchor range
  "version": 42                   // optional — anchor version
}
// 201 → { "comment": { … } }
```

#### `PATCH /api/v1/docs/:id/comments/:cid` — capability `commenter`
Resolve / unresolve. Body `{ "resolved": true }` → `{ "ok": true }`.

### Share links

#### `GET /api/v1/docs/:id/links` — capability `owner`
→ `{ "links": [ … ] }`.

#### `POST /api/v1/docs/:id/links` — capability `owner`
```json
// body
{ "mode": "guest" | "member", "capability": "editor" | "commenter" | "viewer" }
// 201 → { "link": { "token", "mode", "capability", "url" } }
```
Guest links cannot grant `editor` (400) — guests may review, not rewrite.

#### `DELETE /api/v1/docs/:id/links/:linkId` — capability `owner`
Revoke. → `{ "ok": true }`.

---

## Agent recipes

**Read, then edit by quoting** (the normal agent loop):
```bash
BASE=https://markbase.so
AUTH="Authorization: Bearer $MARKBASE_API_KEY"

# 1. read the markdown
curl -s -H "$AUTH" "$BASE/api/v1/docs/$ID" | jq -r .doc.content

# 2. edit a passage by quoting it
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"quote":"Status: draft","insert":"Status: ready for review"}' \
  "$BASE/api/v1/docs/$ID/edits"
# → {"version":43}   (or 422 if the quote no longer matches, or 409 on conflict)
```

**Rewrite the whole document** (no bulk endpoint — quote all of it):
```bash
OLD=$(curl -s -H "$AUTH" "$BASE/api/v1/docs/$ID" | jq -r '.doc.content')
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d "$(jq -n --arg q "$OLD" --arg i "$(cat new.md)" '{quote:$q, insert:$i}')" \
  "$BASE/api/v1/docs/$ID/edits"
```

**Leave a review comment:**
```bash
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"body":"This section needs a source.","quotedText":"...","from":120,"to":180}' \
  "$BASE/api/v1/docs/$ID/comments"
```

On `409 conflict`, re-read (`GET …/:id`) and retry the edit — the document moved
under you. On `422 Anchor not found`, your `quote` no longer matches; re-read and
re-quote.

---

## Package exports (`@markbase/docs`)

Headless helpers used by both the editor and the API:

- `markdownToDoc` / `docToMarkdown` / `emptyDoc` / `deriveTitle` — markdown ⇄ doc.
- `docExtensions` / `docSchema` — the shared TipTap schema (client editor + server).
- `anchoredEditToSteps` — resolve a `{ quote, insert }` edit to steps.
- `applySteps` / `docReplaceSteps` / `diffSegments` — step + diff utilities.
- `docJsonIsValid` — guard a stored `doc_json` against the current schema.
- `@markbase/docs/server` — the authority + persistence (`receiveSteps`,
  `setMarkdownContent`, `restoreVersion`, history/diff, comments, links, members,
  capabilities).
