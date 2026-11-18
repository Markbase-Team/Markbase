import {
  createTab,
  deleteDocument,
  getDocument,
  listTabs,
  publishDocument,
  publishVersions,
  reorderTabs,
  unpublishDocument,
} from "../server";
import { endpoint } from "./define";
import { json } from "./respond";

// A document's tabs, and whether it is on the public web.

// GET — the tabs of this document's group.
export const listTabsEndpoint = endpoint({
  id: "docs_listTabs",
  method: "GET",
  path: "/docs/:id/tabs",
  capability: "viewer",
  scope: "read",
  summary: "List the document's tabs",
  humanOnly: true,
  why: "Tabs were removed from the app; the endpoints stay for documents that still have them.",
}, async (_req, _params, auth) => {
  return json({ tabs: await listTabs(auth.doc.tab_group_id) });
});

// POST — add a new (empty) tab to this document's group.
export const addTabEndpoint = endpoint({
  id: "docs_addTab",
  method: "POST",
  path: "/docs/:id/tabs",
  capability: "editor",
  scope: "write",
  summary: "Add a tab",
  humanOnly: true,
  why: "Tabs were removed from the app; the endpoints stay for documents that still have them.",
}, async (_req, { id }) => {
  return json({ tab: await createTab(id) }, 201);
});

// PATCH — reorder this document's tabs. Body: { order: [tabId, …] }, the
// tabs' new left-to-right order. Editors+.
export const reorderTabsEndpoint = endpoint({
  id: "docs_reorderTabs",
  method: "PATCH",
  path: "/docs/:id/tabs",
  capability: "editor",
  scope: "write",
  params: [
    { name: "order", type: "json", required: true, description: "Array of tab ids in the new order." },
  ],
  summary: "Reorder tabs",
  humanOnly: true,
  why: "Tabs were removed from the app; the endpoints stay for documents that still have them.",
}, async (req, _params, auth) => {
  let body: { order?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (
    !Array.isArray(body.order) ||
    body.order.some((x) => typeof x !== "string")
  ) {
    return json({ error: "order (string[]) is required" }, 400);
  }
  await reorderTabs(auth.doc.tab_group_id, body.order);
  return json({ tabs: await listTabs(auth.doc.tab_group_id) });
});

// DELETE — remove a tab from this document's group. The last remaining tab
// can't be deleted. Editors+.
export const deleteTabEndpoint = endpoint({
  id: "docs_deleteTab",
  method: "DELETE",
  path: "/docs/:id/tabs/:tabId",
  capability: "editor",
  scope: "write",
  summary: "Delete a tab (never the last)",
  humanOnly: true,
  why: "Tabs were removed from the app; the endpoints stay for documents that still have them.",
}, async (_req, { id, tabId }, auth) => {
  const tab = await getDocument(tabId);
  if (!tab || tab.tab_group_id !== auth.doc.tab_group_id) {
    return json({ error: "Tab not found in this document" }, 404);
  }
  const tabs = await listTabs(auth.doc.tab_group_id);
  if (tabs.length <= 1) {
    return json({ error: "Can't delete the last tab" }, 400);
  }
  await deleteDocument(tabId);
  // Return the remaining tabs so the client can pick the next one to show.
  return json({ tabs: tabs.filter((t) => t.id !== tabId) });
});

/** Where a published document is read. Built from the request, so it follows the host. */
const publicUrl = (req: Request, slug: string): string =>
  `${new URL(req.url).origin}/p/${slug}`;

/** What every publish answer carries: where it is, which version, and the choices. */
async function publishAnswer(req: Request, id: string): Promise<Response> {
  const doc = await getDocument(id);
  const published = Boolean(doc?.published_at);
  const versions = await publishVersions(id, doc?.content ?? null);
  return json({
    published,
    url: published && doc?.public_slug ? publicUrl(req, doc.public_slug) : null,
    // The pin only means something while the document is public.
    version: published ? versions.version : null,
    behind: published && versions.behind,
    versions: versions.versions,
  });
}

// GET — current publish status and the versions to choose from (owner only).
// Publishing a document to the web: a public page at its own URL, pinned to
// a version.
export const publishStatusEndpoint = endpoint({
  id: "docs_publishStatus",
  method: "GET",
  path: "/docs/:id/publish",
  capability: "owner",
  scope: "read",
  summary: "Whether a document is published, its public URL, and the versions to choose from",
}, async (req, { id }) => {
  return publishAnswer(req, id);
});

// POST { version? } — publish to the web (owner only). With no version the
// text as it stands is published; with one, that version. Keeps the URL.
export const publishEndpoint = endpoint({
  id: "docs_publish",
  method: "POST",
  path: "/docs/:id/publish",
  capability: "owner",
  scope: "write",
  params: [
    { name: "version", type: "number", description: "The version index (from /history) to publish; omitted, the text as it stands." },
  ],
  summary: "Publish a document to the web (anyone with the URL can read it)",
}, async (req, { id }, auth) => {
  let body: { version?: number } = {};
  try {
    body = (await req.json()) as { version?: number };
  } catch {
    // No body: publish the text as it stands.
  }
  if (body.version !== undefined && !Number.isInteger(body.version)) {
    return json({ error: "version must be a whole number" }, 400);
  }
  try {
    await publishDocument(id, auth.actor, body.version);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Could not publish" }, 400);
  }
  return publishAnswer(req, id);
});

// DELETE — take it offline (owner only).
export const unpublishEndpoint = endpoint({
  id: "docs_unpublish",
  method: "DELETE",
  path: "/docs/:id/publish",
  capability: "owner",
  scope: "write",
  summary: "Take a published document offline",
}, async (req, { id }) => {
  await unpublishDocument(id);
  return publishAnswer(req, id);
});
