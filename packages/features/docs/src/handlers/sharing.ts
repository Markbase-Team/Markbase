import {
  createComment,
  createLink,
  dispatchMentions,
  listComments,
  listLinks,
  revokeLink,
  setCommentResolved,
  type Capability,
  type LinkMode,
} from "../server";
import { requireDocEndpoint } from "./actor";
import { json } from "./respond";

// Comments and share links: the two ways a document reaches someone else.

export const docCommentsHandler = {
  // GET — all comments (viewer+).
  GET: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_listComments");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    return json({ comments: await listComments(id) });
  },

  // POST — add a comment or reply (commenter+). A root comment carries
  // { body, quotedText, from, to, version }; a reply carries { body, parentId }.
  POST: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_addComment");
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    let body: {
      body?: string;
      parentId?: string;
      quotedText?: string;
      from?: number;
      to?: number;
      version?: number;
    } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (typeof body.body !== "string" || !body.body.trim()) {
      return json({ error: "body is required" }, 400);
    }

    const comment = await createComment({
      docId: id,
      parentId: typeof body.parentId === "string" ? body.parentId : null,
      quotedText: typeof body.quotedText === "string" ? body.quotedText : "",
      anchorFrom: typeof body.from === "number" ? body.from : 0,
      anchorTo: typeof body.to === "number" ? body.to : 0,
      anchorVersion: typeof body.version === "number" ? body.version : 0,
      body: body.body.trim(),
      author: auth.actor,
    });

    await dispatchMentions({
      docId: id,
      doc: auth.doc,
      comment: { id: comment.id, body: comment.body },
      author: auth.actor,
    });

    return json({ comment }, 201);
  },
};

export const docCommentHandler = {
  // PATCH { resolved } — resolve/unresolve a thread (commenter+).
  PATCH: async (req: Request, id: string, cid: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_resolveComment");
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    let body: { resolved?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (typeof body.resolved !== "boolean") {
      return json({ error: "resolved (boolean) required" }, 400);
    }
    await setCommentResolved(id, cid, body.resolved);
    return json({ ok: true });
  },
};

const MODES: LinkMode[] = ["member", "guest"];
const CAPS: Capability[] = ["editor", "commenter", "viewer"];

/** Where a share token is redeemed. Built from the request, so it follows the host. */
const shareUrl = (req: Request, token: string): string =>
  `${new URL(req.url).origin}/d/${token}`;

export const docLinksHandler = {
  // GET — the doc's active share links (owner only).
  GET: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_listLinks");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const links = await listLinks(id);
    return json({
      links: links.map((l) => ({ ...l, url: shareUrl(req, l.token) })),
    });
  },

  // POST { mode, capability } — mint a share link (owner).
  POST: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_createLink");
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    let body: { mode?: string; capability?: string } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const mode = body.mode as LinkMode;
    const capability = body.capability as Capability;
    if (!MODES.includes(mode) || !CAPS.includes(capability)) {
      return json({ error: "mode and capability required" }, 400);
    }
    // Guests are anonymous — they can never be editors.
    if (mode === "guest" && capability === "editor") {
      return json({ error: "guest links can't grant edit access" }, 400);
    }

    const link = await createLink({
      docId: id,
      mode,
      capability,
      createdBy: auth.actor.userId ?? auth.doc.owner_id,
    });
    return json({ link: { ...link, url: shareUrl(req, link.token) } }, 201);
  },
};

export const docLinkHandler = {
  // DELETE — revoke a share link (owner only).
  DELETE: async (req: Request, id: string, linkId: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_deleteLink");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    await revokeLink(linkId, id);
    return json({ ok: true });
  },
};
