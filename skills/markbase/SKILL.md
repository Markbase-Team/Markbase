---
name: markbase
version: 0.9.2
description: Read and write Markbase collaborative markdown documents over the HTTP API — list/create docs, edit a passage by quoting it, comment, and read version history. Use when the user shares a Markbase doc link (markbase.so/dashboard/documents/…) or asks to work with a Markbase document, or mentions MARKBASE_API_KEY.
---

# Markbase collaborative docs

Markbase docs are "Google Docs for markdown": humans and agents edit the same
documents in real time through one HTTP API. Every change is attributed and
versioned, and you edit through the *same* API a human's browser uses — so your
edits appear live in any open editor.

<!-- This file is GENERATED from SKILL.template.md + the endpoint registry.
     Edit the template or packages/docs/src/endpoints.ts, then regenerate. -->

## Setup

- **API base URL:** `https://markbase.so/api/v1` — the API root, **including `/api/v1`**
  (override with the `MARKBASE_API_BASE` env var, which must also include
  `/api/v1`). Paths below append to `$BASE` — do **not** add `/api/v1` again.
- **Auth:** send `Authorization: Bearer $MARKBASE_API_KEY` on every request.
  Create a key in the dashboard → API keys. **Never print the key.**
- **Say which tool you are:** send `X-MCP-Client: <tool>` on every request —
  `claude-code`, `codex` or `cursor`. Your edits are then credited as
  "Jessie's Claude" in the document's history and analytics; without it they
  read "Jessie's agent".

Every recipe below assumes:

```bash
BASE="${MARKBASE_API_BASE:-https://markbase.so/api/v1}"
AUTH="Authorization: Bearer $MARKBASE_API_KEY"
CLIENT="X-MCP-Client: claude-code"   # the tool you are: claude-code, codex, cursor
```

## Editing → always use `/edits`

Every change to a document goes through `POST /docs/:id/edits`. There is **no
whole-document replace endpoint** — you build up and change docs one passage at
a time, so edits stay minimal and never clobber concurrent work or history.

1. **Read** the current markdown — `GET /docs/:id` → `.doc.content`.
2. **Copy the exact passage** you want to change — its rendered text, minus any
   markdown syntax (`##`, `**`, `[]()`), verbatim (same words, punctuation,
   casing, whitespace).
3. **POST** `{"quote": "<that exact passage>", "insert": "<replacement>"}` to
   `/docs/:id/edits`. It replaces only the matched text and leaves the rest of
   the document — its history and other people's edits — untouched.

**Starting a document:** create it with `POST /docs` (optionally seeded with a
`content` markdown string for the first version). To fill in a doc that only has
a heading, quote the heading and insert the heading plus the body.

**Rewriting everything:** there's no bulk-replace shortcut — quote the entire
current `.doc.content` and insert the whole new document in one `/edits` call.

`quote` matches the document's **rendered text**, never markdown syntax — quote
`Summary` (not `## Summary`), `ready` (not `**ready**`), `PR #67` (not
`[PR #67](url)`). `insert` is **markdown**: inline markup (`**bold**`,
`[link](url)`) merges into the block, and block markup (headings, lists,
blockquotes, multiple paragraphs) is inserted as real structure. On read-back
`.doc.content` shows the markdown syntax back — but your next `quote` still uses
the rendered text (`ready`, `PR #67`), not what you inserted.

**Errors:** `422 Anchor not found` → your `quote` didn't match the current text
exactly; re-read the doc and copy it verbatim. `409 conflict` → someone edited
concurrently; re-read and re-apply. If you have a real question for the human,
**leave a comment** instead of guessing.

## Endpoints

Each endpoint lists the **minimum role** it needs. Roles are ranked `owner > editor > commenter > viewer`, so any role at or above the one shown is allowed (an owner can do everything an editor can). `signed-in` = any authenticated caller with the right scope.

| Method & path | Role | Purpose |
| --- | --- | --- |
| `GET    $BASE/docs/search` | signed-in | Search your documents by title and text |
| `GET    $BASE/docs/:id/history` | viewer | Version history (who changed what, +added/−removed) |
| `GET    $BASE/docs/:id/analytics` | viewer | Analytics (which agents read it and for whom, who wrote each line) |
| `GET    $BASE/docs/:id/at` | viewer | The document as of a version |
| `GET    $BASE/docs/:id/diff` | viewer | Word-level diff between two versions |
| `GET    $BASE/docs` | signed-in | List your documents |
| `POST   $BASE/docs` | signed-in | Create a document |
| `GET    $BASE/docs/:id` | viewer | Read one document (markdown + current version) |
| `PATCH  $BASE/docs/:id` | editor | Rename a document |
| `DELETE $BASE/docs/:id` | owner | Delete a whole document (all its tabs) |
| `POST   $BASE/docs/:id/edits` | editor | Edit a passage (quote → insert) — the only way to change a doc |
| `POST   $BASE/docs/:id/restore` | editor | Restore a past version (appended as a new edit) |
| `GET    $BASE/docs/:id/comments` | viewer | List comments |
| `POST   $BASE/docs/:id/comments` | commenter | Comment on a passage / ask the human a question |
| `PATCH  $BASE/docs/:id/comments/:cid` | commenter | Resolve / unresolve a comment |
| `GET    $BASE/docs/:id/links` | owner | List share links |
| `POST   $BASE/docs/:id/links` | owner | Create a share link |
| `DELETE $BASE/docs/:id/links/:linkId` | owner | Revoke a share link |
| `GET    $BASE/docs/:id/publish` | owner | Whether a document is published, its public URL, and the versions to choose from |
| `POST   $BASE/docs/:id/publish` | owner | Publish a document to the web (anyone with the URL can read it) |
| `DELETE $BASE/docs/:id/publish` | owner | Take a published document offline |
| `GET    $BASE/vaults` | signed-in | List your vaults |
| `POST   $BASE/vaults` | signed-in | Create a vault |
| `GET    $BASE/vaults/:id` | signed-in | One of your vaults (404: gone; 403: somebody else's) |
| `PATCH  $BASE/vaults/:id` | signed-in | Rename a vault |
| `DELETE $BASE/vaults/:id` | signed-in | Delete a vault and every document in it |
| `POST   $BASE/vaults/convert` | signed-in | Make a folder inside a vault a vault of its own |
| `GET    $BASE/docs/start` | signed-in | Where to begin: your vaults, newest documents and things to try |
| `GET    $BASE/assets` | signed-in | List the images and files in a vault, or the ones a document links to |
| `GET    $BASE/docs/:id/status` | viewer | Status (core fields, warnings, trust, whether a review is due) |
| `POST   $BASE/docs/:id/verify` | editor | Confirm the current text is right, as you |
| `GET    $BASE/docs/views` | signed-in | Query a view: documents filtered, sorted and grouped by their properties |
| `POST   $BASE/docs/:id/properties` | editor | Set one property (front matter field) of a document |
| `GET    $BASE/me` | signed-in | Whose key this is: the owner's id and name, and the connection |
| `GET    $BASE/me/profile` | signed-in | The account's display name and sign-in name |

## How to use

### Search your documents by title and text
`GET /docs/search` · role: **signed-in** · scope: read

- **When:** To find a document by what it says rather than listing them all and reading each.
- **Input:** `?q=<words> · ?vault=<id> · ?scope=shared`
- **Output:** { hits: [{ id, title, snippet }] }

```bash
curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/search?q=roadmap" | jq '.hits'
```

### Version history (who changed what, +added/−removed)
`GET /docs/:id/history` · role: **viewer** · scope: read

- **When:** To see how a document evolved or find a version to restore.
- **Output:** { version, revisions: [{ from_version, to_version, author, added, removed }] }

```bash
curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/$ID/history" | jq '.revisions'
```

### Analytics (which agents read it and for whom, who wrote each line)
`GET /docs/:id/analytics` · role: **viewer** · scope: read

- **When:** To see which agents read a document and on whose behalf, or who wrote what is in it now — a person, or an agent and whose agent.
- **Output:** { reads: [{ agent, owner, count, lastAt, text }], credit: { lines, shares: [{ writer, text, lines }], ranges: [{ from, to, writer, text, preview }] } } — text is the writer in words ("Jessie's Claude"); writer.kind is agent, person, mixed or unrecorded; credit is null when the history cannot be read

```bash
curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/$ID/analytics" | jq '.credit.shares'
```

### List your documents
`GET /docs` · role: **signed-in** · scope: read

- **When:** To find a document or see what you can access. `?scope=shared` lists what others shared with you, with your capability on each.
- **Input:** `?scope=shared · ?vault=<id> · (nothing: your own documents)`
- **Output:** { docs: [{ id, title, excerpt, version, updated_at, capability? }] }

```bash
curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs" | jq '.docs'
```

### Create a document
`POST /docs` · role: **signed-in** · scope: write

- **When:** To start a new document. Seed the first version with `content` markdown; edit it afterwards with /edits.
- **Input:** `{ title?: string, content?: markdown }`
- **Output:** { doc: { id, title, version, … } }

```bash
curl -s -X POST -H "$AUTH" -H "$CLIENT" -H 'content-type: application/json' \
  -d '{"title":"My doc","content":"# My doc\n"}' "$BASE/docs"
```

### Read one document (markdown + current version)
`GET /docs/:id` · role: **viewer** · scope: read

- **When:** Always read before you edit — you quote from the current text.
- **Output:** { doc: { id, title, content: markdown, version }, capability }

```bash
curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/$ID" | jq -r '.doc.content'
```

### Edit a passage (quote → insert) — the only way to change a doc
`POST /docs/:id/edits` · role: **editor** · scope: write

- **When:** Every change to an existing document. `quote` matches the rendered text (no markdown syntax — `ready`, not `**ready**`); `insert` is markdown whose structure is preserved (inline marks merge; headings/lists become real blocks). To add, quote an anchor line and repeat it at the start of `insert`.
- **Input:** `{ quote: string (rendered text), insert: markdown }`
- **Output:** { version: number }  ·  422 if the quote didn’t match  ·  409 on conflict

```bash
curl -s -X POST -H "$AUTH" -H "$CLIENT" -H 'content-type: application/json' \
  -d '{"quote":"Status: draft","insert":"Status: **ready**"}' "$BASE/docs/$ID/edits"
```

### Restore a past version (appended as a new edit)
`POST /docs/:id/restore` · role: **editor** · scope: write

- **When:** To undo back to a known-good version; history is preserved.
- **Input:** `{ version: number }`
- **Output:** { version: number }

```bash
curl -s -X POST -H "$AUTH" -H "$CLIENT" -H 'content-type: application/json' \
  -d '{"version":N}' "$BASE/docs/$ID/restore"
```

### Comment on a passage / ask the human a question
`POST /docs/:id/comments` · role: **commenter** · scope: write

- **When:** When you have a real question or a suggestion you shouldn’t just apply. Anchor it to text with `quotedText`. Calls the Markbase API, POST /api/v1/docs/{id}/comments; see https://markbase.so/docs/agents.
- **Input:** `{ body: markdown, quotedText?: string, parentId?: uuid }`
- **Output:** { comment: { … } }

```bash
curl -s -X POST -H "$AUTH" -H "$CLIENT" -H 'content-type: application/json' \
  -d '{"body":"X or Y?","quotedText":"the passage"}' "$BASE/docs/$ID/comments"
```

### List your vaults
`GET /vaults` · role: **signed-in** · scope: read

- **When:** To see which vaults exist before listing, searching or creating documents in one.
- **Input:** `(nothing)`
- **Output:** { vaults: [{ id, name, created_at }] }

```bash
curl -s -H "$AUTH" -H "$CLIENT" "$BASE/vaults" | jq '.vaults'
```

### Where to begin: your vaults, newest documents and things to try
`GET /docs/start` · role: **signed-in** · scope: read

- **When:** When the person has just connected Markbase, asks what they can do with it, or is unsure where to begin. Offer what it suggests.
- **Input:** `(nothing)`
- **Output:** { vaults: [{ id, name }], documents: [{ id, title, excerpt, vault_id, updated_at }], suggestions: [{ title, description, prompt }] }

```bash
curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/start" | jq '.suggestions'
```

### Status (core fields, warnings, trust, whether a review is due)
`GET /docs/:id/status` · role: **viewer** · scope: read

- **When:** To know how far to trust a document before relying on it: whether anyone confirmed its current text (a person or an agent), whether it is deprecated, and whether a review is due.
- **Output:** { fields: { type, status, superseded_by, owner, audience, covers, review_by }, warnings: [{ field, message }], last_meaningful_change, trust: unverified | agent_confirmed | human_confirmed, current_confirmations: [{ by, at, name }], needs_review }

```bash
curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/$ID/status" | jq '{trust, needs_review}'
```

### Confirm the current text is right, as you
`POST /docs/:id/verify` · role: **editor** · scope: write

- **When:** Only after checking the document against its source (the code, the system, the person who knows) and finding it right. Recorded in your name; the next meaningful edit ends it. You can't confirm a change you made.
- **Output:** { verified: { by, at }, trust }  ·  409 if you made the last change

```bash
curl -s -X POST -H "$AUTH" -H "$CLIENT" "$BASE/docs/$ID/verify"
```

### Query a view: documents filtered, sorted and grouped by their properties
`GET /docs/views` · role: **signed-in** · scope: read

- **When:** To find documents by their front matter rather than their words: what is on someone's plate (view=today), or any filter, sort and grouping of your own over the documents you can open.
- **Input:** `?view=today&tz=America/Los_Angeles · ?spec={"filter":{"field":"type","op":"eq","value":"incident"}}`
- **Output:** { name, title, today, time_zone, rows: [{ id, title, path, vault_id, updated_at, fields }], groups?: [{ key, rows }], truncated }

```bash
curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/views?view=today&tz=America/Los_Angeles" | jq '.groups'
```

### Set one property (front matter field) of a document
`POST /docs/:id/properties` · role: **editor** · scope: write

- **When:** To change one field of a document's front matter without touching the rest: mark a task done (done: true), move a due date, reassign it (assignee: human:<id> or agent:<name>), deprecate a doc (status: deprecated).
- **Input:** `{ key: string, value: JSON }`
- **Output:** { key, value }

```bash
curl -s -X POST -H "$AUTH" -H "$CLIENT" -H 'content-type: application/json' -d '{"key":"done","value":true}' "$BASE/docs/$ID/properties"
```

## Capabilities

Your key acts as its owner — or the lower **ceiling** set on the key (an agent
key can be limited to editor/commenter/viewer). Effective access on a doc is the
lower of the key's ceiling and what its owner could do. A `403` means the key
lacks the capability the endpoint needs; a `409` means the doc moved under you.
