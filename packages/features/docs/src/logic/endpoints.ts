import type { Capability } from "../server/auth";

// The single registry of document HTTP endpoints. It is the source of truth for
// two things:
//   1. Authorization — each endpoint declares the minimum `capability` a caller
//      needs. Capabilities are ranked (owner > editor > commenter > viewer), so
//      any role at or above the declared one is allowed (see `atLeast`).
//   2. The agent skill — endpoints marked with `skill` metadata are rendered
//      into skills/markbase/SKILL.md by `renderEndpointsDoc`, so the skill's
//      "when / how / input / output" always match the real endpoints.
// Change an endpoint here and both the enforced role and the skill follow.

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type EndpointScope = "read" | "write";
export type ParamType = "string" | "number" | "boolean" | "json";

// A body/query parameter (path params like :id are derived from `path`, not
// listed here). Drives the MCP tool's JSON input schema.
export interface EndpointParam {
  name: string;
  type: ParamType;
  required?: boolean;
  description?: string;
}

// How an agent should use an endpoint — rendered into the skill verbatim.
export interface EndpointSkillDoc {
  /** When to reach for this endpoint. */
  whenToUse: string;
  /** The request body / query it expects (one line). "" for none. */
  input: string;
  /** What it returns (one line). */
  output: string;
  /** Optional copy-pasteable example (a JSON body or a curl one-liner). */
  example?: string;
}

export interface DocEndpoint {
  /** Stable id used by routes to look up their capability. */
  id: string;
  method: HttpMethod;
  /** Path under /api/v1, e.g. "/docs/:id/edits". */
  path: string;
  /** Minimum per-doc capability. null = account-level (auth + scope only). */
  capability: Capability | null;
  /** OAuth-style scope the API key must carry. */
  scope: EndpointScope;
  /** Body/query parameters (path params are derived from `path`). */
  params?: readonly EndpointParam[];
  /** One-line summary (endpoints table). */
  summary: string;
  /** Editor-only plumbing (the real-time collab protocol). Hidden from the agent
   *  skill and from `markbase api` — agents must not see or call these. Routes
   *  still resolve them for the browser editor. */
  humanOnly?: boolean;
  /** Present when this endpoint is documented in the agent skill. */
  skill?: EndpointSkillDoc;
}

export const DOC_ENDPOINTS: readonly DocEndpoint[] = [
  {
    id: "docs_listDocs",
    method: "GET",
    path: "/docs",
    capability: null,
    scope: "read",
    params: [
      { name: "scope", type: "string", description: "`shared`: only documents other people shared with you (each with your `capability` on it)." },
      { name: "vault", type: "string", description: "Only the documents in one of your vaults." },
    ],
    summary: "List your documents",
    skill: {
      whenToUse:
        "To find a document or see what you can access. `?scope=shared` lists what others shared with you, with your capability on each.",
      input: "?scope=shared · ?vault=<id> · (nothing: your own documents)",
      output: '{ docs: [{ id, title, version, updated_at, capability? }] }',
      example: `curl -s -H "$AUTH" "$BASE/docs" | jq '.docs'`,
    },
  },
  {
    id: "docs_createDoc",
    method: "POST",
    path: "/docs",
    capability: null,
    scope: "write",
    params: [
      { name: "title", type: "string", description: "Document title." },
      { name: "content", type: "string", description: "Initial markdown for the first version." },
      {
        name: "vault_id",
        type: "string",
        required: false,
        description: "One of your own vaults to create it in; omitted, your default vault. Someone else's vault is refused (403).",
      },
    ],
    summary: "Create a document",
    skill: {
      whenToUse:
        "To start a new document. Seed the first version with `content` markdown; edit it afterwards with /edits.",
      input: '{ title?: string, content?: markdown }',
      output: '{ doc: { id, title, version, … } }',
      example: `curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \\
  -d '{"title":"My doc","content":"# My doc\\n"}' "$BASE/docs"`,
    },
  },
  {
    id: "docs_readDoc",
    method: "GET",
    path: "/docs/:id",
    capability: "viewer",
    scope: "read",
    summary: "Read one document (markdown + current version)",
    skill: {
      whenToUse:
        "Always read before you edit — you quote from the current text.",
      input: "",
      output: '{ doc: { id, title, content: markdown, version }, capability }',
      example: `curl -s -H "$AUTH" "$BASE/docs/$ID" | jq -r '.doc.content'`,
    },
  },
  {
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
      example: `curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \\
  -d '{"quote":"Status: draft","insert":"Status: **ready**"}' "$BASE/docs/$ID/edits"`,
    },
  },
  {
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
      example: `curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \\
  -d '{"version":N}' "$BASE/docs/$ID/restore"`,
    },
  },
  {
    id: "docs_listComments",
    method: "GET",
    path: "/docs/:id/comments",
    capability: "viewer",
    scope: "read",
    summary: "List comments",
  },
  {
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
        "When you have a real question or a suggestion you shouldn’t just apply. Anchor it to text with `quotedText`.",
      input: '{ body: markdown, quotedText?: string, parentId?: uuid }',
      output: '{ comment: { … } }',
      example: `curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \\
  -d '{"body":"X or Y?","quotedText":"the passage"}' "$BASE/docs/$ID/comments"`,
    },
  },
  {
    id: "docs_resolveComment",
    method: "PATCH",
    path: "/docs/:id/comments/:cid",
    capability: "commenter",
    scope: "write",
    params: [
      { name: "resolved", type: "boolean", required: true, description: "true to resolve, false to reopen." },
    ],
    summary: "Resolve / unresolve a comment",
  },
  {
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
      example: `curl -s -H "$AUTH" "$BASE/docs/$ID/history" | jq '.revisions'`,
    },
  },
  {
    id: "docs_renameDoc",
    method: "PATCH",
    path: "/docs/:id",
    capability: "editor",
    scope: "write",
    params: [
      { name: "title", type: "string", required: true, description: "New title." },
    ],
    summary: "Rename a document",
  },
  {
    id: "docs_deleteDoc",
    method: "DELETE",
    path: "/docs/:id",
    capability: "owner",
    scope: "write",
    summary: "Delete a whole document (all its tabs)",
  },
  // A member's own membership of a shared document — the Shared Vault's
  // plumbing (docs/shared-vault.md). Where the member files the document in
  // THEIR folder, and leaving the share. Viewer: any member may do both. The
  // owner is refused by the handler, having no membership. Not for agents: a
  // folder layout is a person's, and leaving a share is not an edit.
  {
    id: "docs_setMemberPath",
    method: "PATCH",
    path: "/docs/:id/membership",
    capability: "viewer",
    scope: "write",
    params: [
      { name: "path", type: "string", description: "Where the document sits in your Shared Vault; null for the default layout." },
    ],
    summary: "File a shared document in your Shared Vault",
    humanOnly: true,
  },
  {
    id: "docs_leaveShare",
    method: "DELETE",
    path: "/docs/:id/membership",
    capability: "viewer",
    scope: "write",
    summary: "Leave a document someone shared with you",
    humanOnly: true,
  },
  {
    id: "docs_listTabs",
    method: "GET",
    path: "/docs/:id/tabs",
    capability: "viewer",
    scope: "read",
    summary: "List the document's tabs",
  },
  {
    id: "docs_addTab",
    method: "POST",
    path: "/docs/:id/tabs",
    capability: "editor",
    scope: "write",
    summary: "Add a tab",
  },
  {
    id: "docs_reorderTabs",
    method: "PATCH",
    path: "/docs/:id/tabs",
    capability: "editor",
    scope: "write",
    params: [
      { name: "order", type: "json", required: true, description: "Array of tab ids in the new order." },
    ],
    summary: "Reorder tabs",
  },
  {
    id: "docs_deleteTab",
    method: "DELETE",
    path: "/docs/:id/tabs/:tabId",
    capability: "editor",
    scope: "write",
    summary: "Delete a tab (never the last)",
  },
  // The document's CRDT state — the editor's and the vault daemon's plumbing
  // (security lockdown stage 2). The capability each one requires is what the
  // API has always required of the operation it stands for: a viewer may read
  // the document, an editor may change it. Agents never see these; they edit
  // through /edits, which lands in this same state.
  {
    id: "docs_readCrdt",
    method: "GET",
    path: "/docs/:id/crdt",
    capability: "viewer",
    scope: "read",
    summary: "The document's CRDT snapshot",
    humanOnly: true,
  },
  {
    id: "docs_writeCrdt",
    method: "POST",
    path: "/docs/:id/crdt",
    capability: "editor",
    scope: "write",
    summary: "Merge a CRDT snapshot into the document",
    humanOnly: true,
  },
  {
    id: "docs_crdtChanges",
    method: "GET",
    path: "/docs/crdt/changes",
    capability: null,
    scope: "read",
    params: [
      { name: "since", type: "string", required: false, description: "The cursor the last answer returned; absent = establish one." },
      { name: "vault", type: "string", required: false, description: "One of your own vaults. Shared documents live in their owner's vault, so they are not in it." },
      { name: "scope", type: "string", required: false, description: "`shared`: the documents shared with you, whichever vault they sit in. Exclusive with vault." },
    ],
    summary: "Which of your documents' snapshots changed since a cursor",
    humanOnly: true,
  },
  // Lower-level endpoints (used by the editor / power users; not in the skill).
  {
    id: "docs_docAt",
    method: "GET",
    path: "/docs/:id/at",
    capability: "viewer",
    scope: "read",
    params: [
      { name: "version", type: "number", required: true, description: "Version to read." },
    ],
    summary: "The document as of a version",
  },
  {
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
  },
  {
    id: "docs_listLinks",
    method: "GET",
    path: "/docs/:id/links",
    capability: "owner",
    scope: "read",
    summary: "List share links",
  },
  {
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
  },
  {
    id: "docs_deleteLink",
    method: "DELETE",
    path: "/docs/:id/links/:linkId",
    capability: "owner",
    scope: "write",
    summary: "Revoke a share link",
  },
] as const;

// The endpoints agents may see and call — everything except editor-only plumbing.
export const AGENT_ENDPOINTS: readonly DocEndpoint[] = DOC_ENDPOINTS.filter(
  (e) => !e.humanOnly
);

const BY_ID = new Map(DOC_ENDPOINTS.map((e) => [e.id, e]));

/** Look up an endpoint by id (throws if unknown — ids are checked-in constants). */
export function docEndpoint(id: string): DocEndpoint {
  const e = BY_ID.get(id);
  if (!e) throw new Error(`Unknown doc endpoint: ${id}`);
  return e;
}

// ---------------------------------------------------------------------------
// The ticket worker's endpoints (security lockdown stage 2).
//
// Declared here so the registry stays the one list of what /api/v1 serves and
// what each entry needs — account-level (`capability: null`), the scope the key
// must carry — but marked `humanOnly`: these are the worker loop's plumbing,
// not tools an agent should see in the skill, the MCP server or `markbase api`.
// The handlers live in @markbase/projects (the feature that owns tickets and
// jobs) and the owner is always the key's; nothing in a request body names one.
// apps/web/test/worker-routes.test.ts checks every entry has its route file.
// ---------------------------------------------------------------------------
export const WORKER_ENDPOINTS: readonly DocEndpoint[] = [
  {
    id: "worker_claim",
    method: "POST",
    path: "/worker/claim",
    capability: null,
    scope: "write",
    params: [
      { name: "version", type: "string", description: "The worker's version, recorded as presence." },
      { name: "reclaim", type: "boolean", description: "Run the staleness sweep first (once, at startup)." },
    ],
    summary: "Claim the next queued job for the key's owner; answers { job, rescan }",
    humanOnly: true,
  },
  {
    id: "worker_heartbeat",
    method: "POST",
    path: "/worker/heartbeat",
    capability: null,
    scope: "write",
    params: [{ name: "jobId", type: "string", required: true }],
    summary: "Keep a running job and its ticket fresh",
    humanOnly: true,
  },
  {
    id: "worker_readJob",
    method: "GET",
    path: "/worker/jobs/:id",
    capability: null,
    scope: "read",
    summary: "One of the owner's jobs, as it is now (cancellation shows here)",
    humanOnly: true,
  },
  {
    id: "worker_finishJob",
    method: "POST",
    path: "/worker/jobs/:id/finish",
    capability: null,
    scope: "write",
    params: [
      { name: "status", type: "string", required: true, description: "'done' | 'error'" },
      { name: "error", type: "string" },
    ],
    summary: "Mark a job done or failed",
    humanOnly: true,
  },
  {
    id: "worker_reportRepos",
    method: "POST",
    path: "/worker/repos",
    capability: null,
    scope: "write",
    params: [{ name: "repos", type: "json", required: true }],
    summary: "Replace the owner's discovered repos with this machine's scan",
    humanOnly: true,
  },
  {
    id: "worker_reportSessions",
    method: "POST",
    path: "/worker/sessions",
    capability: null,
    scope: "write",
    params: [{ name: "sessions", type: "json", required: true }],
    summary: "Replace the owner's discovered Claude sessions, attributed to this key",
    humanOnly: true,
  },
  {
    id: "worker_listAgentRequests",
    method: "GET",
    path: "/worker/agent-requests",
    capability: null,
    scope: "read",
    summary: "Queued spawn and mention requests waiting for the owner's worker",
    humanOnly: true,
  },
  {
    id: "worker_claimAgentRequest",
    method: "POST",
    path: "/worker/agent-requests/:id/claim",
    capability: null,
    scope: "write",
    params: [{ name: "kind", type: "string", required: true, description: "'spawn' | 'message'" }],
    summary: "Take one request, with what the worker needs to act on it",
    humanOnly: true,
  },
  {
    id: "worker_finishAgentRequest",
    method: "POST",
    path: "/worker/agent-requests/:id/finish",
    capability: null,
    scope: "write",
    params: [
      { name: "kind", type: "string", required: true, description: "'spawn' | 'message'" },
      { name: "status", type: "string", required: true, description: "'done' | 'error'" },
      { name: "error", type: "string" },
    ],
    summary: "Mark a spawn or mention request done or failed",
    humanOnly: true,
  },
  {
    id: "worker_claudeVersion",
    method: "PATCH",
    path: "/worker/claude-version",
    capability: null,
    scope: "write",
    params: [{ name: "version", type: "string", description: "`claude --version`, or null when not installed." }],
    summary: "Record this machine's Claude Code version on its key",
    humanOnly: true,
  },
  {
    id: "tickets_readTicket",
    method: "GET",
    path: "/tickets/:id",
    capability: null,
    scope: "read",
    summary: "One of the owner's tickets",
    humanOnly: true,
  },
  {
    id: "tickets_updateTicket",
    method: "PATCH",
    path: "/tickets/:id",
    capability: null,
    scope: "write",
    summary: "Update a ticket, including the run-tracking fields the worker reports",
    humanOnly: true,
  },
  {
    id: "tickets_addMessage",
    method: "POST",
    path: "/tickets/:id/messages",
    capability: null,
    scope: "write",
    params: [
      { name: "content", type: "string", required: true },
      { name: "role", type: "string", description: "'assistant' (default) | 'user'" },
    ],
    summary: "Add a message to a ticket's thread without starting a run",
    humanOnly: true,
  },
  {
    id: "me_plan",
    method: "GET",
    path: "/me/plan",
    capability: null,
    scope: "read",
    summary: "The caller's plan",
    humanOnly: true,
  },
  {
    id: "projects_readProject",
    method: "GET",
    path: "/projects/:slug",
    capability: null,
    scope: "read",
    summary: "One of the owner's projects",
    humanOnly: true,
  },
] as const;

/** Every declared endpoint, documents and worker alike. */
export const ALL_ENDPOINTS: readonly DocEndpoint[] = [...DOC_ENDPOINTS, ...WORKER_ENDPOINTS];
