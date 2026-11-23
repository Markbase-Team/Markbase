import { callerFromHeaders, type Caller } from "@markbase/shared/auth";
import type { EndpointCall, JsonValue } from "@markbase/shared/endpoint";
import type { McpProtocolEvent } from "@markbase/shared/mcp-http";
import {
  actorOf,
  isSyncRequest,
  outcomeOfStatus,
  type UserAnalyticsChannel,
  type UserAnalyticsEvent,
} from "@markbase/shared/analytics/user-analytics";

// User analytics — what turns a handled request into an event.
//
// Nothing here is called by an endpoint. The web server observes every defined
// endpoint (@markbase/shared/endpoint) and its MCP server reports what a client
// asked of it; each is turned into an event here and written by the store. So
// an endpoint or a tool that is added is recorded with nothing to remember.
//
// A create's path names nothing (POST /docs), so what it made is read from
// its answer instead (`createdIdsOf`).
//
// What is recorded, and what is left out:
//   - Only endpoints an agent may call (not `humanOnly`). Those are exactly the
//     MCP tools, so the record and the tool list cannot drift apart. The rest
//     is plumbing a customer did not do: the editor's own sync, a worker's
//     polling, the app reading its own settings.
//   - An agent's calls, all of them: reads too, since "what did it look at?"
//     is the question.
//   - A person's calls only when they change something. The app reads all day
//     on its own, and a row per page load would bury the rest.
//   - A request with no caller. There is no account to record it under.
//   - A vault sync's reads (SYNC_REQUEST_HEADER). The machine keeping a folder
//     in step asks what changed every few seconds; none of that is an agent.
//     What a sync changes is still recorded.

/** The MCP client that made this request, when it came through the MCP server. */
function mcpClientOf(req: Request): string | null {
  return req.headers.get("x-mcp-client")?.trim() || null;
}

function channelOf(caller: Caller, client: string | null): UserAnalyticsChannel {
  if (caller.via === "session") return "app";
  return client ? "mcp" : "api";
}

/** The event for a call to an endpoint, or null when it is not one to record. */
export function eventForEndpointCall(call: EndpointCall): UserAnalyticsEvent | null {
  const { def, req, params } = call;
  if (def.humanOnly) return null;
  const caller = callerFromHeaders(req.headers);
  if (!caller) return null;
  if (caller.via === "session" && def.scope === "read") return null;
  if (def.scope === "read" && isSyncRequest(req.headers)) return null;
  const client = mcpClientOf(req);
  // `/docs/:id/…` and `/vaults/:id/…` name what was touched in the path itself.
  const id = params.id ?? null;
  return {
    ownerId: caller.ownerId,
    actor: actorOf(caller, client),
    channel: channelOf(caller, client),
    action: def.id,
    docId: def.path.startsWith("/docs/:id") ? id : null,
    vaultId: def.path.startsWith("/vaults/:id") ? id : null,
    outcome: outcomeOfStatus(call.status),
    status: call.status,
    durationMs: call.durationMs,
  };
}

/** The event for something an MCP client asked of the server itself. */
export function eventForMcpEvent(
  caller: Caller,
  client: string | null,
  event: McpProtocolEvent,
  asked: string | null = null
): UserAnalyticsEvent {
  return {
    ownerId: caller.ownerId,
    actor: actorOf(caller, client),
    channel: "mcp",
    action: `mcp.${event}`,
    // Kept only for the events that have one; the store drops it otherwise.
    detail: asked,
    outcome: event === "unknown_tool" || event === "unknown_method" ? "error" : "success",
  };
}

/** What a create made, as far as the record keeps it. */
export interface CreatedIds {
  docId?: string;
  vaultId?: string;
}

function objectOf(value: JsonValue | undefined): { [key: string]: JsonValue } | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function idIn(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The ids a create's answer names: `{ doc: { id, vault_id } }` or `{ vault: { id } }`. */
export function createdIdsIn(body: JsonValue | null): CreatedIds {
  const top = objectOf(body ?? undefined);
  const doc = objectOf(top?.doc);
  const vault = objectOf(top?.vault);
  const ids: CreatedIds = {};
  const docId = idIn(doc?.id);
  const vaultId = idIn(vault?.id) ?? idIn(doc?.vault_id);
  if (docId) ids.docId = docId;
  if (vaultId) ids.vaultId = vaultId;
  return ids;
}

/**
 * For a create — a POST whose path names nothing, which succeeded — the ids it
 * made, read from its answer: the path cannot say what a create made, so the
 * row would otherwise not know. Null for anything else. Must be called while
 * the observer is being told, since the answer is copied then.
 */
export function createdIdsOf(call: EndpointCall): Promise<CreatedIds> | null {
  const { def, status } = call;
  if (def.method !== "POST" || def.path.includes(":") || status < 200 || status >= 300) return null;
  return call.readBody().then(createdIdsIn, () => ({}));
}
