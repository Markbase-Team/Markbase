---
name: markbase
version: 0.0.0
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

{{ENDPOINTS}}

## Capabilities

Your key acts as its owner — or the lower **ceiling** set on the key (an agent
key can be limited to editor/commenter/viewer). Effective access on a doc is the
lower of the key's ceiling and what its owner could do. A `403` means the key
lacks the capability the endpoint needs; a `409` means the doc moved under you.
