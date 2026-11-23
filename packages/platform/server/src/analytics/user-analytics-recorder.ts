import { callerFromHeaders, type Caller } from "@markbase/shared/auth";
import type { EndpointCall } from "@markbase/shared/endpoint";
import type { McpProtocolEvent } from "@markbase/shared/mcp-http";
import {
  actorOf,
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
