import {
  diffSegments,
  docAnalytics,
  listVersions,
  markdownToDoc,
  versionContent,
  type DocJSON,
} from "@markbase/shared/docs";
import { readDocCrdt, searchDocuments } from "../server";
import { endpoint } from "./define";
import { json } from "./respond";

// The read-only half of the docs API: search, the three version views and the
// analytics, all of which read a document's CRDT without changing it.

// GET ?q=…&vault=… (or ?scope=shared) — search the caller's documents by
// title + markdown content, scoped like the sidebar that calls it.
// Search, as the sidebar does it.
export const searchDocsEndpoint = endpoint({
  id: "docs_searchDocs",
  method: "GET",
  path: "/docs/search",
  capability: null,
  scope: "read",
  params: [
    { name: "q", type: "string", required: true, description: "What to look for, in titles and in the text." },
    { name: "vault", type: "string", description: "Only the documents in one of your vaults." },
    { name: "scope", type: "string", description: "`shared`: only documents other people shared with you." },
  ],
  summary: "Search your documents by title and text",
  skill: {
    whenToUse:
      "To find a document by what it says rather than listing them all and reading each.",
    input: "?q=<words> · ?vault=<id> · ?scope=shared",
    output: "{ hits: [{ id, title, snippet }] }",
    example: `curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/search?q=roadmap" | jq '.hits'`,
  },
}, async (req, _params, a) => {
  const params = new URL(req.url).searchParams;
  const shared = params.get("scope") === "shared";
  const hits = await searchDocuments(a.actor.userId, {
    query: params.get("q") ?? "",
    // Shared-with-me searches across owners' vaults, so a vault filter is moot.
    vaultId: shared ? undefined : (params.get("vault") ?? undefined),
    shared,
  });
  return json({ hits });
});

// GET — the document's version history from its CRDT (one entry per settled
// edit), oldest first. Each version has a 0-based `index` used by /at, /diff
// and /restore.
export const historyEndpoint = endpoint({
  id: "docs_history",
  method: "GET",
  path: "/docs/:id/history",
  capability: "viewer",
  scope: "read",
  summary: "Version history (who changed what, +added/−removed)",
  skill: {
    whenToUse: "To see how a document evolved or find a version to restore.",
    input: "",
    output: '{ version, revisions: [{ from_version, to_version, author, added, removed }] }',
    example: `curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/$ID/history" | jq '.revisions'`,
  },
}, async (_req, { id }, auth) => {
  const versions = await readDocCrdt(id, auth.doc.content, (doc) =>
    listVersions(doc)
  );
  return json({ version: versions.length, revisions: versions });
});

// GET — the document's analytics from its CRDT: which agents read it and for
// whom, and who wrote each line that is in it now. The one place every surface
// asks — the Analytics panel on the web and the desktop, and an agent's tool.
export const analyticsEndpoint = endpoint({
  id: "docs_analytics",
  method: "GET",
  path: "/docs/:id/analytics",
  capability: "viewer",
  scope: "read",
  summary: "Analytics (which agents read it and for whom, who wrote each line)",
  skill: {
    whenToUse:
      "To see which agents read a document and on whose behalf, or who wrote what is in it now — a person, or an agent and whose agent.",
    input: "",
    output:
      '{ reads: [{ agent, owner, count, lastAt, text }], credit: { lines, shares: [{ writer, text, lines }], ranges: [{ from, to, writer, text, preview }] } } — text is the writer in words ("Jessie\'s Claude"); writer.kind is agent, person, mixed or unrecorded; credit is null when the history cannot be read',
    example: `curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/$ID/analytics" | jq '.credit.shares'`,
  },
}, async (_req, { id }, auth) => {
  return json(await readDocCrdt(id, auth.doc.content, docAnalytics));
});

// GET ?version=V — the document as of CRDT version index V, for previewing a
// past version. V is the 0-based `index` from /history.
// Lower-level endpoints (used by the editor / power users; not in the skill).
export const docAtEndpoint = endpoint({
  id: "docs_docAt",
  method: "GET",
  path: "/docs/:id/at",
  capability: "viewer",
  scope: "read",
  params: [
    { name: "version", type: "number", required: true, description: "Version to read." },
  ],
  summary: "The document as of a version",
}, async (req, { id }, auth) => {
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
});

// GET ?from=X&to=Y — inline word-diff of the markdown between two CRDT
// version indices (from /history). from <= to.
export const docDiffEndpoint = endpoint({
  id: "docs_docDiff",
  method: "GET",
  path: "/docs/:id/diff",
  capability: "viewer",
  scope: "read",
  params: [
    { name: "from", type: "number", required: true, description: "Older version." },
    { name: "to", type: "number", required: true, description: "Newer version." },
  ],
  summary: "Word-level diff between two versions",
}, async (req, { id }, auth) => {
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
});
