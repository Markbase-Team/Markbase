// User analytics — what happened to a customer's vaults and documents, and
// who did it. The customer's own record, readable by them and by their
// agents; not to be confused with ./funnel, which is our telemetry about the
// app.
//
// This file is the shape both sides agree on. The server writes and reads the
// rows (@markbase/server/analytics/user-analytics-store); a screen or an agent
// reads them through the API. Nothing here records anything: an event is
// recorded by the server as it handles a request, never reported by a client.
//
// What an event holds, and what it never does: whose data was touched, who
// acted, through which door, the NAME of what was asked (an endpoint or tool
// id) and how it ended. No argument values and no document content.

import { providerFromClient, type Provider } from "../agent-sessions";
import type { Caller } from "../auth";
import { ALL_ENDPOINTS } from "../docs/endpoints";
import { isDefinedEndpointId } from "../endpoint";

export const USER_ANALYTICS_PATH = "/api/v1/user-analytics";

/**
 * The door an action came through: an MCP tool call, a plain API request, an
 * agent's hook on the person's machine (a file read or written directly), or
 * the app itself.
 */
export const USER_ANALYTICS_CHANNELS = ["mcp", "api", "hook", "app"] as const;
export type UserAnalyticsChannel = (typeof USER_ANALYTICS_CHANNELS)[number];

export function isUserAnalyticsChannel(value: string | null | undefined): value is UserAnalyticsChannel {
  return (USER_ANALYTICS_CHANNELS as readonly string[]).includes(value ?? "");
}

/**
 * Actions that are not an API endpoint: what an MCP client asked of the
 * server itself, and what an agent's hook saw on the person's machine.
 */
export const USER_ANALYTICS_EVENT_ACTIONS = [
  "mcp.initialize",
  "mcp.tools_list",
  "mcp.unknown_tool",
  "mcp.unknown_method",
  "hook.read",
  "hook.write",
] as const;
export type UserAnalyticsEventAction = (typeof USER_ANALYTICS_EVENT_ACTIONS)[number];

const ENDPOINT_ACTIONS: ReadonlySet<string> = new Set(ALL_ENDPOINTS.map((endpoint) => endpoint.id));

/**
 * Whether an action may be recorded. The set is closed: the id of an endpoint
 * — one in the registry (`docs_readDoc`) or one any feature has defined
 * through an endpoint set — or one of the events above. The column is
 * text, so this check is what keeps a typo or a made-up name out of the
 * record — and a new endpoint is recordable the moment it is registered, with
 * no migration.
 */
export function isUserAnalyticsAction(value: string | null | undefined): boolean {
  if (!value) return false;
  if (ENDPOINT_ACTIONS.has(value) || isDefinedEndpointId(value)) return true;
  return (USER_ANALYTICS_EVENT_ACTIONS as readonly string[]).includes(value);
}

/**
 * How an action ended. `denied` is a refusal for lack of permission — a key's
 * ceiling, a document the caller may not open; `error` is every other failure.
 */
export const USER_ANALYTICS_OUTCOMES = ["success", "denied", "error"] as const;
export type UserAnalyticsOutcome = (typeof USER_ANALYTICS_OUTCOMES)[number];

export function isUserAnalyticsOutcome(value: string | null | undefined): value is UserAnalyticsOutcome {
  return (USER_ANALYTICS_OUTCOMES as readonly string[]).includes(value ?? "");
}

/** The outcome an HTTP status stands for. */
export function outcomeOfStatus(status: number): UserAnalyticsOutcome {
  if (status === 401 || status === 403) return "denied";
  return status >= 200 && status < 400 ? "success" : "error";
}

/**
 * Who acted. A person is the account itself; an agent is named by the key it
 * used, the tool that holds the key and, over MCP, the client's own name. An
 * agent whose file hook reported it has no key of its own: `keyId` is the
 * sync daemon's, or null, and `client` is the name the hook gave.
 */
export type UserAnalyticsActor =
  | { kind: "person" }
  | { kind: "agent"; keyId: string | null; provider: Provider; client: string | null };

/** One action, as the server hands it to the store. */
export interface UserAnalyticsEvent {
  /**
   * The account the action was made under: the person, or the person an
   * agent's key belongs to. For a shared document that is the one who acted,
   * not the document's owner — who still sees it, through the document.
   */
  ownerId: string;
  actor: UserAnalyticsActor;
  channel: UserAnalyticsChannel;
  /** One `isUserAnalyticsAction` accepts: an endpoint id, or an MCP or hook event. */
  action: string;
  /**
   * Only for `mcp.unknown_tool` and `mcp.unknown_method`: the name the client
   * asked for. A protocol name, never an argument or content.
   */
  detail?: string | null;
  vaultId?: string | null;
  docId?: string | null;
  outcome: UserAnalyticsOutcome;
  /** The HTTP status, when there was one. */
  status?: number | null;
  durationMs?: number | null;
  /** When it happened, ISO, for an action reported after the fact (a hook's). Now when absent. */
  at?: string;
}

/** One action, as it is read back. */
export interface UserAnalyticsRecord {
  id: number;
  at: string;
  actor: UserAnalyticsActor;
  channel: UserAnalyticsChannel;
  action: string;
  detail: string | null;
  vaultId: string | null;
  docId: string | null;
  outcome: UserAnalyticsOutcome;
  status: number | null;
  durationMs: number | null;
}

/** How often one account's tool read a document, as worked out from the rows. */
export interface DocReadSummary {
  ownerId: string;
  provider: Provider;
  /** The name an agent's hook gave it; null for reads made through the API. */
  client: string | null;
  count: number;
  /** ISO time of the last read. */
  lastAt: string;
}

/**
 * Which rows a reader may see. Core does not decide this: the caller works it
 * out (a feature knows which documents someone may view) and states it here.
 */
export type UserAnalyticsScope =
  | { kind: "owner"; ownerId: string }
  | { kind: "docs"; docIds: string[] };

export interface UserAnalyticsQuery {
  scope: UserAnalyticsScope;
  vaultId?: string;
  docId?: string;
  channel?: UserAnalyticsChannel;
  action?: string;
  outcome?: UserAnalyticsOutcome;
  /** ISO time; rows at or after it. */
  since?: string;
  /** A record id; rows older than it. The cursor for the next page. */
  before?: number;
  limit?: number;
}

export const USER_ANALYTICS_DEFAULT_LIMIT = 50;
export const USER_ANALYTICS_MAX_LIMIT = 200;
export const USER_ANALYTICS_CLIENT_MAX = 80;
export const USER_ANALYTICS_DETAIL_MAX = 80;

/** The actions whose row says what was asked for, because it was not there. */
const DETAILED_ACTIONS: readonly string[] = ["mcp.unknown_tool", "mcp.unknown_method"];

/**
 * The detail to keep for an action: the name a client asked for, for the two
 * actions that have one, and nothing for any other. It comes from the client,
 * so it is cut to one short line of printable characters.
 */
export function userAnalyticsDetail(action: string, detail: string | null | undefined): string | null {
  if (!DETAILED_ACTIONS.includes(action) || !detail) return null;
  const clean = detail.replace(/[^\x20-\x7e]/g, "").trim().slice(0, USER_ANALYTICS_DETAIL_MAX);
  return clean || null;
}

/** A page size within bounds, whatever was asked for. */
export function clampUserAnalyticsLimit(limit: number | null | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return USER_ANALYTICS_DEFAULT_LIMIT;
  return Math.min(USER_ANALYTICS_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * The actor behind a request the gate has already identified. `client` is the
 * MCP client's name when the request came through the MCP server.
 */
export function actorOf(caller: Caller, client: string | null = null): UserAnalyticsActor {
  if (caller.via === "session") return { kind: "person" };
  const name = client?.trim() ?? "";
  const said = providerFromClient(name);
  return {
    kind: "agent",
    keyId: caller.key.id,
    // The tool is what this request says it is, else what the key was stamped
    // with: one key is often shared by several tools.
    provider: said === "unknown" ? caller.key.provider : said,
    client: name ? name.slice(0, USER_ANALYTICS_CLIENT_MAX) : null,
  };
}
