import type { Capability } from "../server/auth";
import type { EndpointDef } from "@markbase/protocol/endpoint";
import { GENERATED_DOC_ENDPOINTS } from "./endpoints.generated";

// What an endpoint is, and the list of them all.
//
// A documents endpoint is WRITTEN in one place: beside the code that answers
// it, as `endpoint({ id, method, path, capability, … }, run)` in src/handlers
// (the machinery is every feature's: @markbase/protocol/endpoint).
// That one definition is its description, its access rule (`capability`, which
// the wrapper enforces before `run` is called — owner > editor > commenter >
// viewer, any role at or above the declared one is allowed) and its code.
//
// This file is what everything else READS: the shape of a description, and the
// lists built from the generated copy of those definitions. The MCP server's
// tools, the agent skill (skills/markbase/SKILL.md, via `renderEndpointsDoc`)
// and `markbase api` all come from here, so they follow a definition without
// anyone touching them.

export type {
  HttpMethod,
  EndpointScope,
  ParamType,
  EndpointParam,
  EndpointSkillDoc,
} from "@markbase/protocol/endpoint";

/**
 * A documents endpoint: what every endpoint says (@markbase/protocol/endpoint),
 * plus the one thing that is this feature's own — the role a caller needs on
 * the document the path names.
 */
export interface DocEndpoint extends EndpointDef {
  /** Minimum per-doc capability. null = account-level (auth + scope only). */
  capability: Capability | null;
}

// The documents endpoints. Each is written once, beside the code that answers
// it (src/handlers, `endpoint(def, run)`); this is the generated description of
// them all — see endpoints.generated.ts for why there is a copy.
export const DOC_ENDPOINTS: readonly DocEndpoint[] = GENERATED_DOC_ENDPOINTS;

// ---------------------------------------------------------------------------
// The account's own endpoints: who a key belongs to, and how an agent's client
// learns its tools. Served by the web app itself rather than by a feature.
// ---------------------------------------------------------------------------
export const ACCOUNT_ENDPOINTS: readonly DocEndpoint[] = [
  {
    id: "me_whoami",
    method: "GET",
    path: "/me",
    capability: null,
    scope: "read",
    summary: "Whose key this is: the owner's id and name, and the connection",
  },
  {
    id: "me_readProfile",
    method: "GET",
    path: "/me/profile",
    capability: null,
    scope: "read",
    summary: "The account's display name and sign-in name",
  },
  {
    id: "me_setProfile",
    method: "PUT",
    path: "/me/profile",
    capability: null,
    scope: "write",
    params: [{ name: "display_name", type: "string", required: true, description: "An empty string clears it." }],
    summary: "Set the account's display name",
    humanOnly: true,
    why: "The name edits are credited under is the person's to choose.",
  },
  {
    id: "agent_listTools",
    method: "GET",
    path: "/agent/tools",
    capability: null,
    scope: "read",
    summary: "The tools an agent may call, as this server defines them now",
    humanOnly: true,
    why: "How the MCP server learns its tools; it is not one of them.",
  },
];

// The endpoints agents may see and call — everything a person can do in the
// app, except what an entry says `why` not.
export const AGENT_ENDPOINTS: readonly DocEndpoint[] = [...DOC_ENDPOINTS, ...ACCOUNT_ENDPOINTS].filter(
  (e) => !e.humanOnly
);

const BY_ID = new Map([...DOC_ENDPOINTS, ...ACCOUNT_ENDPOINTS].map((e) => [e.id, e]));

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
const WORKER_WHY = "The ticket worker's loop, not a tool: a worker claims and reports jobs under its own key.";

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
    why: WORKER_WHY,
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
    why: WORKER_WHY,
  },
  {
    id: "worker_readJob",
    method: "GET",
    path: "/worker/jobs/:id",
    capability: null,
    scope: "read",
    summary: "One of the owner's jobs, as it is now (cancellation shows here)",
    humanOnly: true,
    why: WORKER_WHY,
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
    why: WORKER_WHY,
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
    why: WORKER_WHY,
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
    why: WORKER_WHY,
  },
  {
    id: "worker_listAgentRequests",
    method: "GET",
    path: "/worker/agent-requests",
    capability: null,
    scope: "read",
    summary: "Queued spawn and mention requests waiting for the owner's worker",
    humanOnly: true,
    why: WORKER_WHY,
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
    why: WORKER_WHY,
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
    why: WORKER_WHY,
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
    why: WORKER_WHY,
  },
  {
    id: "tickets_readTicket",
    method: "GET",
    path: "/tickets/:id",
    capability: null,
    scope: "read",
    summary: "One of the owner's tickets",
    humanOnly: true,
    why: WORKER_WHY,
  },
  {
    id: "tickets_updateTicket",
    method: "PATCH",
    path: "/tickets/:id",
    capability: null,
    scope: "write",
    summary: "Update a ticket, including the run-tracking fields the worker reports",
    humanOnly: true,
    why: WORKER_WHY,
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
    why: WORKER_WHY,
  },
  {
    id: "me_plan",
    method: "GET",
    path: "/me/plan",
    capability: null,
    scope: "read",
    summary: "The caller's plan",
    humanOnly: true,
    why: WORKER_WHY,
  },
  {
    id: "projects_readProject",
    method: "GET",
    path: "/projects/:slug",
    capability: null,
    scope: "read",
    summary: "One of the owner's projects",
    humanOnly: true,
    why: WORKER_WHY,
  },
] as const;

/** Every declared endpoint: documents, the account, and the worker. */
export const ALL_ENDPOINTS: readonly DocEndpoint[] = [
  ...DOC_ENDPOINTS,
  ...ACCOUNT_ENDPOINTS,
  ...WORKER_ENDPOINTS,
];
