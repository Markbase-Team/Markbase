import {
  diffSegments,
  listVersions,
  markdownToDoc,
  versionContent,
  type DocJSON,
} from "../logic";
import { readDocCrdt, searchDocuments } from "../server";
import { accountActor, requireDocEndpoint } from "./actor";
import { json } from "./respond";

// The read-only half of the docs API: search, and the three version views that
// read a document's CRDT without changing it.

// GET ?q=…&vault=… (or ?scope=shared) — search the caller's documents by
// title + markdown content, scoped like the sidebar that calls it.
export const docsSearchHandler = async (req: Request): Promise<Response> => {
  const a = await accountActor(req);
  if ("error" in a) return a.error;

  const params = new URL(req.url).searchParams;
  const shared = params.get("scope") === "shared";
  const hits = await searchDocuments(a.userId, {
    query: params.get("q") ?? "",
    // Shared-with-me searches across owners' vaults, so a vault filter is moot.
    vaultId: shared ? undefined : (params.get("vault") ?? undefined),
    shared,
  });
  return json({ hits });
};

// GET — the document's version history from its CRDT (one entry per settled
// edit), oldest first. Each version has a 0-based `index` used by /at, /diff
// and /restore.
export const docHistoryHandler = async (req: Request, id: string): Promise<Response> => {
  const auth = await requireDocEndpoint(req, id, "docs_history");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const versions = await readDocCrdt(id, auth.doc.content, (doc) =>
    listVersions(doc)
  );
  return json({ version: versions.length, revisions: versions });
};

// GET ?version=V — the document as of CRDT version index V, for previewing a
// past version. V is the 0-based `index` from /history.
export const docAtHandler = async (req: Request, id: string): Promise<Response> => {
  const auth = await requireDocEndpoint(req, id, "docs_docAt");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const version = Number(new URL(req.url).searchParams.get("version"));
  if (!Number.isFinite(version) || version < 0) {
    return json({ error: "version (>= 0) required" }, 400);
  }
  try {
    const doc_json = await readDocCrdt(
      id,
      auth.doc.content,
      (doc) => markdownToDoc(versionContent(doc, version)).toJSON() as DocJSON
    );
    return json({ doc_json, version });
  } catch (e) {
    // versionContent throws for an index that doesn't exist.
    return json(
      { error: e instanceof Error ? e.message : `No version ${version}` },
      404
    );
  }
};

// GET ?from=X&to=Y — inline word-diff of the markdown between two CRDT
// version indices (from /history). from <= to.
export const docDiffHandler = async (req: Request, id: string): Promise<Response> => {
  const auth = await requireDocEndpoint(req, id, "docs_docDiff");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const url = new URL(req.url);
  const from = Number(url.searchParams.get("from"));
  const to = Number(url.searchParams.get("to"));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) {
    return json({ error: "from and to (from <= to) required" }, 400);
  }
  try {
    const segments = await readDocCrdt(id, auth.doc.content, (doc) =>
      diffSegments(versionContent(doc, from), versionContent(doc, to))
    );
    return json({ segments });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "No such version" },
      404
    );
  }
};
