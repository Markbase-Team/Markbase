import { applyAnchoredEdit, restoreVersion } from "@markbase/shared/docs";
import { editDocCrdt, setDocContent } from "../server";
import { endpoint } from "./define";
import { json } from "./respond";

// The three write paths into a document's CRDT: replace the whole thing,
// replace a quoted passage, or make a past version the head.

// PUT — replace the whole document with `content` markdown, based on
// `version` (editor+).
//
// The local folder mirror's write half. `version` is the version the caller
// last saw; a 409 means someone edited in the browser meanwhile, so the
// caller's text is stale. We report the conflict instead of clobbering — the
// mirror turns that into a conflict file. Omitting `version` is not allowed
// for exactly that reason.
export const replaceContentEndpoint = endpoint({
  id: "docs_replaceContent",
  method: "PUT",
  path: "/docs/:id/content",
  capability: "editor",
  scope: "write",
  params: [
    { name: "content", type: "string", required: true },
    { name: "version", type: "number", required: true, description: "The version the caller last saw; a newer one answers 409." },
  ],
  summary: "Replace a whole document's text",
  humanOnly: true,
  why: "The folder mirror's write. An agent replacing a whole document overwrites what people are typing; it edits a quoted passage through /edits instead.",
}, async (req, { id }, auth) => {
  let body: { content?: string; version?: number } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (typeof body.content !== "string") {
    return json({ error: "content is required" }, 400);
  }
  if (typeof body.version !== "number" || !Number.isFinite(body.version)) {
    return json({ error: "version is required" }, 400);
  }

  const res = await setDocContent({
    docId: id,
    markdown: body.content,
    baseVersion: body.version,
    author: auth.actor,
  });
  if (!res.ok) {
    return json(
      {
        error: "Conflict — the document changed",
        serverVersion: res.serverVersion,
      },
      409
    );
  }
  return json({ version: res.version });
});

// POST — the agent-friendly edit path. Body: { quote, insert } — "replace the
// text matching `quote` with `insert`". We resolve the anchor and apply the
// edit to the SAME CRDT Y.Doc the browser editor and vault daemon sync, so
// agent and human edits converge. No whole-document diff; no version CAS
// (concurrent edits merge in the CRDT rather than conflict).
export const editDocEndpoint = endpoint({
  id: "docs_editDoc",
  method: "POST",
  path: "/docs/:id/edits",
  capability: "editor",
  scope: "write",
  params: [
    { name: "quote", type: "string", required: true, description: "Exact rendered text to replace (no markdown syntax)." },
    { name: "insert", type: "string", required: true, description: "Replacement markdown (structure preserved)." },
  ],
  summary: "Edit a passage (quote → insert) — the only way to change a doc",
  skill: {
    whenToUse:
      "Every change to an existing document. `quote` matches the rendered text (no markdown syntax — `ready`, not `**ready**`); `insert` is markdown whose structure is preserved (inline marks merge; headings/lists become real blocks). To add, quote an anchor line and repeat it at the start of `insert`.",
    input: '{ quote: string (rendered text), insert: markdown }',
    output: '{ version: number }  ·  422 if the quote didn’t match  ·  409 on conflict',
    example: `curl -s -X POST -H "$AUTH" -H "$CLIENT" -H 'content-type: application/json' \\
  -d '{"quote":"Status: draft","insert":"Status: **ready**"}' "$BASE/docs/$ID/edits"`,
  },
}, async (req, { id }, auth) => {
  let body: { quote?: string; insert?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (typeof body.quote !== "string" || typeof body.insert !== "string") {
    return json({ error: "quote and insert (strings) required" }, 400);
  }
  const quote = body.quote;
  const insert = body.insert;

  try {
    // The seam records the edit as a version in the actor's name, so /history
    // and "Who wrote it" see it even for a doc no browser has open.
    await editDocCrdt(id, auth.doc.content, { actor: auth.actor }, (doc) => {
      // Edit the markdown source where the quote can be found there, so the
      // rest of the document keeps the formatting it was written with. Only a
      // quote that exists solely in the rendered projection (across a hard
      // wrap or a block boundary) falls back to deriving and re-serializing —
      // which used to be the only path, and flattened tables on every agent
      // edit.
      applyAnchoredEdit(doc, { quote, insert });
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Anchor not found";
    // A quote that no longer matches is a client error, not a server fault.
    return json({ error: message }, /anchor not found/i.test(message) ? 422 : 500);
  }
  return json({ ok: true });
});

// POST { version } — make a past CRDT version the new head by writing its
// content back as a normal edit (editor+). Nothing is rewound; history stays
// intact and the restore itself becomes a version. `version` is the 0-based
// index from /history.
export const restoreDocEndpoint = endpoint({
  id: "docs_restoreDoc",
  method: "POST",
  path: "/docs/:id/restore",
  capability: "editor",
  scope: "write",
  params: [
    { name: "version", type: "number", required: true, description: "The version to restore." },
  ],
  summary: "Restore a past version (appended as a new edit)",
  skill: {
    whenToUse: "To undo back to a known-good version; history is preserved.",
    input: '{ version: number }',
    output: '{ version: number }',
    example: `curl -s -X POST -H "$AUTH" -H "$CLIENT" -H 'content-type: application/json' \\
  -d '{"version":N}' "$BASE/docs/$ID/restore"`,
  },
}, async (req, { id }, auth) => {
  let body: { version?: number } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (typeof body.version !== "number" || body.version < 0) {
    return json({ error: "version (>= 0) required" }, 400);
  }
  const version = body.version;

  try {
    await editDocCrdt(id, auth.doc.content, { actor: auth.actor, label: `Restored version ${version + 1}` }, (doc) => {
      restoreVersion(doc, version); // throws if the version index doesn't exist
    });
    return json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Restore failed";
    return json({ error: message }, /no version/i.test(message) ? 422 : 500);
  }
});
