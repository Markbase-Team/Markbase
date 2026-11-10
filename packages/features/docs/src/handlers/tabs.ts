import {
  createTab,
  deleteDocument,
  getDocument,
  listTabs,
  publishDocument,
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

export const docPublishHandler = {
  // GET — current publish status (owner only).
  GET: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocCapability(req, id, "owner");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const doc = await getDocument(id);
    const published = Boolean(doc?.published_at);
    return json({
      published,
      url:
        published && doc?.public_slug ? publicUrl(req, doc.public_slug) : null,
    });
  },

  // POST — publish to the web (owner only). Idempotent; keeps the same URL.
  POST: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocCapability(req, id, "owner");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const { slug } = await publishDocument(id);
    return json({ published: true, url: publicUrl(req, slug) });
  },

  // DELETE — take it offline (owner only).
  DELETE: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocCapability(req, id, "owner");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    await unpublishDocument(id);
    return json({ published: false, url: null });
  },
};
