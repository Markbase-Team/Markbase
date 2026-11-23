import { afterResponse } from "./after-response";
import type { Caller } from "@markbase/shared/auth";
import { observeEndpointCalls } from "@markbase/shared/endpoint";
import type { McpProtocolEvent } from "@markbase/shared/mcp-http";
import {
  eventForEndpointCall,
  eventForMcpEvent,
} from "@markbase/server/analytics/user-analytics-recorder";
import { recordUserAnalytics } from "@markbase/server/analytics/user-analytics-store";

// User analytics — where this server plugs the recorder in.
//
// The record of what happened to a customer's data is written by the server as
// it answers, never by an endpoint: `startUserAnalytics` observes every
// endpoint any feature defines, and the MCP route reports what a client asked
// of the server itself. See @markbase/server/analytics/user-analytics-recorder
// for what is recorded and what is left out.

/** Observe every defined endpoint. Called once, when the server starts. */
export function startUserAnalytics(): void {
  observeEndpointCalls((call) => {
    // Read the request now, while it is live; only the write waits.
    const event = eventForEndpointCall(call);
    if (event) afterResponse(() => recordUserAnalytics(event));
  });
}

/** Record something an MCP client asked of the server itself. */
export function noteMcpEvent(caller: Caller, client: string | null, event: McpProtocolEvent, asked?: string): void {
  const row = eventForMcpEvent(caller, client, event, asked ?? null);
  afterResponse(() => recordUserAnalytics(row));
}
