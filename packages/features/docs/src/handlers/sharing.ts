import { accountOf } from "../logic";
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
import { endpoint } from "./define";
import { json } from "./respond";

// Comments and share links: the two ways a document reaches someone else.

// GET — all comments (viewer+).
export const listCommentsEndpoint = endpoint({
  id: "docs_listComments",
  method: "GET",
  path: "/docs/:id/comments",
  capability: "viewer",
  scope: "read",
  summary: "List comments",
}, async (_req, { id }) => {
  return json({ comments: await listComments(id) });
});

// POST — add a comment or reply (commenter+). A root comment carries
// { body, quotedText, from, to, version }; a reply carries { body, parentId }.
export const addCommentEndpoint = endpoint({
  id: "docs_addComment",
  method: "POST",
  path: "/docs/:id/comments",
  capability: "commenter",
  scope: "write",
  params: [
    { name: "body", type: "string", required: true, description: "The comment (markdown)." },
    { name: "quotedText", type: "string", description: "Text to anchor the comment to." },
    { name: "parentId", type: "string", description: "Reply to this comment id." },
  ],
  summary: "Comment on a passage / ask the human a question",
  skill: {
    whenToUse:
      "When you have a real question or a suggestion you shouldn’t just apply. Anchor it to text with `quotedText`. Calls the Markbase API, POST /api/v1/docs/{id}/comments; see https://markbase.so/docs/agents.",
    input: '{ body: markdown, quotedText?: string, parentId?: uuid }',
    output: '{ comment: { … } }',
    example: `curl -s -X POST -H "$AUTH" -H "$CLIENT" -H 'content-type: application/json' \\
  -d '{"body":"X or Y?","quotedText":"the passage"}' "$BASE/docs/$ID/comments"`,
  },
}, async (req, { id }, auth) => {
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
});

// PATCH { resolved } — resolve/unresolve a thread (commenter+).
export const resolveCommentEndpoint = endpoint({
  id: "docs_resolveComment",
  method: "PATCH",
  path: "/docs/:id/comments/:cid",
  capability: "commenter",
  scope: "write",
  params: [
    { name: "resolved", type: "boolean", required: true, description: "true to resolve, false to reopen." },
  ],
  summary: "Resolve / unresolve a comment",
}, async (req, { id, cid }) => {
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
});

const MODES: LinkMode[] = ["member", "guest"];
const CAPS: Capability[] = ["editor", "commenter", "viewer"];

/** Where a share token is redeemed. Built from the request, so it follows the host. */
const shareUrl = (req: Request, token: string): string =>
  `${new URL(req.url).origin}/d/${token}`;

// GET — the doc's active share links (owner only).
export const listLinksEndpoint = endpoint({
  id: "docs_listLinks",
  method: "GET",
  path: "/docs/:id/links",
  capability: "owner",
  scope: "read",
  summary: "List share links",
}, async (req, { id }) => {
  const links = await listLinks(id);
  return json({
    links: links.map((l) => ({ ...l, url: shareUrl(req, l.token) })),
  });
});

// POST { mode, capability } — mint a share link (owner).
export const createLinkEndpoint = endpoint({
  id: "docs_createLink",
  method: "POST",
  path: "/docs/:id/links",
  capability: "owner",
  scope: "write",
  params: [
    { name: "mode", type: "string", required: true, description: "'guest' or 'member'." },
    { name: "capability", type: "string", description: "editor / commenter / viewer." },
  ],
  summary: "Create a share link",
}, async (req, { id }, auth) => {
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
    createdBy: accountOf(auth.actor) ?? auth.doc.owner_id,
  });
  return json({ link: { ...link, url: shareUrl(req, link.token) } }, 201);
});

// DELETE — revoke a share link (owner only).
export const deleteLinkEndpoint = endpoint({
  id: "docs_deleteLink",
  method: "DELETE",
  path: "/docs/:id/links/:linkId",
  capability: "owner",
  scope: "write",
  summary: "Revoke a share link",
  destructive: true,
}, async (_req, { id, linkId }) => {
  await revokeLink(linkId, id);
  return json({ ok: true });
});
