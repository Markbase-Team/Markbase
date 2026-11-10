import { applyAnchoredEdit, checkpoint, restoreVersion } from "../logic";
import { editDocCrdt, setDocContent } from "../server";
import { requireDocCapability, requireDocEndpoint } from "./actor";
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
export const docContentHandler = async (req: Request, id: string): Promise<Response> => {
  const auth = await requireDocCapability(req, id, "editor");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

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
};

// POST — the agent-friendly edit path. Body: { quote, insert } — "replace the
// text matching `quote` with `insert`". We resolve the anchor and apply the
// edit to the SAME CRDT Y.Doc the browser editor and vault daemon sync, so
// agent and human edits converge. No whole-document diff; no version CAS
// (concurrent edits merge in the CRDT rather than conflict).
export const docEditsHandler = async (req: Request, id: string): Promise<Response> => {
  const auth = await requireDocEndpoint(req, id, "docs_editDoc");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

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
    await editDocCrdt(id, auth.doc.content, (doc) => {
      // Edit the markdown source where the quote can be found there, so the
      // rest of the document keeps the formatting it was written with. Only a
      // quote that exists solely in the rendered projection (across a hard
      // wrap or a block boundary) falls back to deriving and re-serializing —
      // which used to be the only path, and flattened tables on every agent
      // edit.
      applyAnchoredEdit(doc, { quote, insert });
      // Record a version so /history stays populated even for a doc no
      // browser has open (only the browser's ticker checkpoints otherwise).
      checkpoint(doc, { author: auth.actor.name });
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Anchor not found";
    // A quote that no longer matches is a client error, not a server fault.
    return json({ error: message }, /anchor not found/i.test(message) ? 422 : 500);
  }
  return json({ ok: true });
};

// POST { version } — make a past CRDT version the new head by writing its
// content back as a normal edit (editor+). Nothing is rewound; history stays
// intact and the restore itself becomes a version. `version` is the 0-based
// index from /history.
export const docRestoreHandler = async (req: Request, id: string): Promise<Response> => {
  const auth = await requireDocEndpoint(req, id, "docs_restoreDoc");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

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
    await editDocCrdt(id, auth.doc.content, (doc) => {
      restoreVersion(doc, version); // throws if the version index doesn't exist
      checkpoint(doc, {
        author: auth.actor.name,
        label: `Restored version ${version + 1}`,
      });
    });
    return json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Restore failed";
    return json({ error: message }, /no version/i.test(message) ? 422 : 500);
  }
};
