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
import { requireDocCapability, requireDocEndpoint } from "./actor";
import { json } from "./respond";

// A document's tabs, and whether it is on the public web.

export const docTabsHandler = {
  // GET — the tabs of this document's group.
  GET: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_listTabs");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    return json({ tabs: await listTabs(auth.doc.tab_group_id) });
  },

  // POST — add a new (empty) tab to this document's group.
  POST: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_addTab");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    return json({ tab: await createTab(id) }, 201);
  },

  // PATCH — reorder this document's tabs. Body: { order: [tabId, …] }, the
  // tabs' new left-to-right order. Editors+.
  PATCH: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_reorderTabs");
    if (!auth.ok) return json({ error: auth.error }, auth.status);

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
  },
};

export const docTabHandler = {
  // DELETE — remove a tab from this document's group. The last remaining tab
  // can't be deleted. Editors+.
  DELETE: async (req: Request, id: string, tabId: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_deleteTab");
    if (!auth.ok) return json({ error: auth.error }, auth.status);

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
  },
};

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

export const docPublishHandler = {
  // GET — current publish status and the versions to choose from (owner only).
  GET: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocCapability(req, id, "owner");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    return publishAnswer(req, id);
  },

  // POST { version? } — publish to the web (owner only). With no version the
  // text as it stands is published; with one, that version. Keeps the URL.
  POST: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocCapability(req, id, "owner");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
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
      await publishDocument(id, body.version);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Could not publish" }, 400);
    }
    return publishAnswer(req, id);
  },

  // DELETE — take it offline (owner only).
  DELETE: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocCapability(req, id, "owner");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    await unpublishDocument(id);
    return publishAnswer(req, id);
  },
};
