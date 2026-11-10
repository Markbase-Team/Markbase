---
name: markbase
version: 0.7.8
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

Every recipe below assumes:

```bash
BASE="${MARKBASE_API_BASE:-https://markbase.so/api/v1}"
AUTH="Authorization: Bearer $MARKBASE_API_KEY"
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
| `GET    $BASE/docs` | signed-in | List your documents |
| `POST   $BASE/docs` | signed-in | Create a document |
| `GET    $BASE/docs/:id` | viewer | Read one document (markdown + current version) |
| `POST   $BASE/docs/:id/edits` | editor | Edit a passage (quote → insert) — the only way to change a doc |
| `POST   $BASE/docs/:id/restore` | editor | Restore a past version (appended as a new edit) |
| `GET    $BASE/docs/:id/comments` | viewer | List comments |
| `POST   $BASE/docs/:id/comments` | commenter | Comment on a passage / ask the human a question |
| `PATCH  $BASE/docs/:id/comments/:cid` | commenter | Resolve / unresolve a comment |
| `GET    $BASE/docs/:id/history` | viewer | Version history (who changed what, +added/−removed) |
| `PATCH  $BASE/docs/:id` | editor | Rename a document |
| `DELETE $BASE/docs/:id` | owner | Delete a whole document (all its tabs) |
| `GET    $BASE/docs/:id/tabs` | viewer | List the document's tabs |
| `POST   $BASE/docs/:id/tabs` | editor | Add a tab |
| `PATCH  $BASE/docs/:id/tabs` | editor | Reorder tabs |
| `DELETE $BASE/docs/:id/tabs/:tabId` | editor | Delete a tab (never the last) |
| `GET    $BASE/docs/:id/at` | viewer | The document as of a version |
| `GET    $BASE/docs/:id/diff` | viewer | Word-level diff between two versions |
| `GET    $BASE/docs/:id/links` | owner | List share links |
| `POST   $BASE/docs/:id/links` | owner | Create a share link |
| `DELETE $BASE/docs/:id/links/:linkId` | owner | Revoke a share link |

## How to use

### List your documents
`GET /docs` · role: **signed-in** · scope: read

- **When:** To find a document or see what you can access. `?scope=shared` lists what others shared with you, with your capability on each.
- **Input:** `?scope=shared · ?vault=<id> · (nothing: your own documents)`
- **Output:** { docs: [{ id, title, version, updated_at, capability? }] }

```bash
curl -s -H "$AUTH" "$BASE/docs" | jq '.docs'
```

### Create a document
`POST /docs` · role: **signed-in** · scope: write

- **When:** To start a new document. Seed the first version with `content` markdown; edit it afterwards with /edits.
- **Input:** `{ title?: string, content?: markdown }`
- **Output:** { doc: { id, title, version, … } }

```bash
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"title":"My doc","content":"# My doc\n"}' "$BASE/docs"
```

### Read one document (markdown + current version)
`GET /docs/:id` · role: **viewer** · scope: read

- **When:** Always read before you edit — you quote from the current text.
- **Output:** { doc: { id, title, content: markdown, version }, capability }

```bash
curl -s -H "$AUTH" "$BASE/docs/$ID" | jq -r '.doc.content'
```

### Edit a passage (quote → insert) — the only way to change a doc
`POST /docs/:id/edits` · role: **editor** · scope: write

- **When:** Every change to an existing document. `quote` matches the rendered text (no markdown syntax — `ready`, not `**ready**`); `insert` is markdown whose structure is preserved (inline marks merge; headings/lists become real blocks). To add, quote an anchor line and repeat it at the start of `insert`.
- **Input:** `{ quote: string (rendered text), insert: markdown }`
- **Output:** { version: number }  ·  422 if the quote didn’t match  ·  409 on conflict

```bash
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"quote":"Status: draft","insert":"Status: **ready**"}' "$BASE/docs/$ID/edits"
```

### Restore a past version (appended as a new edit)
`POST /docs/:id/restore` · role: **editor** · scope: write

- **When:** To undo back to a known-good version; history is preserved.
- **Input:** `{ version: number }`
- **Output:** { version: number }

```bash
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"version":N}' "$BASE/docs/$ID/restore"
```

### Comment on a passage / ask the human a question
`POST /docs/:id/comments` · role: **commenter** · scope: write

- **When:** When you have a real question or a suggestion you shouldn’t just apply. Anchor it to text with `quotedText`.
- **Input:** `{ body: markdown, quotedText?: string, parentId?: uuid }`
- **Output:** { comment: { … } }

```bash
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"body":"X or Y?","quotedText":"the passage"}' "$BASE/docs/$ID/comments"
```

### Version history (who changed what, +added/−removed)
`GET /docs/:id/history` · role: **viewer** · scope: read

- **When:** To see how a document evolved or find a version to restore.
- **Output:** { version, revisions: [{ from_version, to_version, author, added, removed }] }

```bash
curl -s -H "$AUTH" "$BASE/docs/$ID/history" | jq '.revisions'
```

## Capabilities

Your key acts as its owner — or the lower **ceiling** set on the key (an agent
key can be limited to editor/commenter/viewer). Effective access on a doc is the
lower of the key's ceiling and what its owner could do. A `403` means the key
lacks the capability the endpoint needs; a `409` means the doc moved under you.
