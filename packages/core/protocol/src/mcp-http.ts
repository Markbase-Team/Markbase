// The MCP server, as messages: what a hosted `/mcp` route answers.
//
// The local server (`markbase mcp`) speaks MCP over stdio through the SDK and
// lives with the agent. This is the same server for an agent that has no
// machine of ours to run a command on — a chat app, a browser — reached at a
// URL instead. It is written as a function from one JSON-RPC message to its
// answer, with no transport in it, so the route that hosts it stays a few
// lines and this can be tested without a server.
//
// Stateless on purpose. Every message is answered from the message alone, so
// any instance can answer any request and nothing is held between them. The
// one thing a later request needs from an earlier one is the client's name
// (it is only said in `initialize`, and history attributes edits with it), so
// that travels in the session id the client sends back with each request.

import { toolAnnotations, toolInputSchema, type AgentTool, type Json } from "./endpoint-tools";

/** MCP protocol revisions this server answers, newest first. */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = ["2025-11-25", "2025-06-18", "2025-03-26"];

/** The header a client repeats on every request after `initialize`. */
export const MCP_SESSION_HEADER = "Mcp-Session-Id";

export type JsonObject = { [key: string]: Json };

/** What an API call answered, as the tool result is built from it. */
export interface ToolAnswer {
  ok: boolean;
  status: number;
  body: string;
}

/** What the route supplies: who this server is, its tools, and how one is run. */
export interface McpHost {
  name: string;
  version: string;
  tools(): AgentTool[];
  call(tool: AgentTool, args: JsonObject): Promise<ToolAnswer>;
}

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function result(id: Json, value: JsonObject): JsonObject {
  return { jsonrpc: "2.0", id, result: value };
}

function failure(id: Json, code: number, message: string): JsonObject {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolResult(text: string, isError: boolean): JsonObject {
  return { content: [{ type: "text", text }], isError };
}

function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

async function callTool(params: JsonObject, host: McpHost): Promise<JsonObject> {
  const tool = host.tools().find((t) => t.name === params.name);
  if (!tool) return toolResult(`Unknown tool: ${String(params.name)}`, true);
  const args = isObject(params.arguments) ? params.arguments : {};
  try {
    const answer = await host.call(tool, args);
    const text = pretty(answer.body);
    return toolResult(answer.ok ? text : `HTTP ${answer.status}\n${text}`, !answer.ok);
  } catch (err) {
    return toolResult(err instanceof Error ? err.message : String(err), true);
  }
}

/**
 * Answer one JSON-RPC message. Null for a notification, which has no answer.
 */
export async function answerMcp(message: Json, host: McpHost): Promise<JsonObject | null> {
  if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    // A response a client sent us (it has no method) needs no answer either.
    if (isObject(message) && message.jsonrpc === "2.0" && ("result" in message || "error" in message)) return null;
    return failure(null, -32600, "Not a JSON-RPC 2.0 request.");
  }
  const { id, method } = message;
  if (id === undefined) return null;
  const params = isObject(message.params) ? message.params : {};

  switch (method) {
    case "initialize": {
      const asked = params.protocolVersion;
      const protocolVersion =
        typeof asked === "string" && MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return result(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: host.name, version: host.version },
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, {
        tools: host.tools().map((t) => ({
          name: t.name,
          title: toolAnnotations(t).title,
          description: t.description,
          // The schema is plain JSON; the cast only tells TypeScript so.
          inputSchema: JSON.parse(JSON.stringify(toolInputSchema(t))) as JsonObject,
          annotations: { ...toolAnnotations(t) },
        })),
      });
    case "tools/call":
      return result(id, await callTool(params, host));
    default:
      return failure(id, -32601, `Method not found: ${method}`);
  }
}

/** The client's name, when this message is the `initialize` that states it. */
export function clientNameIn(message: Json): string | null {
  if (!isObject(message) || message.method !== "initialize" || !isObject(message.params)) return null;
  const info = message.params.clientInfo;
  return isObject(info) && typeof info.name === "string" && info.name.trim() ? info.name.trim().slice(0, 64) : null;
}

const SESSION_PREFIX = "mb1.";

/**
 * A session id that is the client's name and nothing else. It identifies no
 * one and grants nothing — the API key does both — so it needs no secret: it
 * is the label the client gave itself, handed back to it to repeat.
 */
export function sessionIdFor(clientName: string): string {
  const bytes = new TextEncoder().encode(clientName);
  const base64 = btoa(String.fromCharCode(...bytes));
  return SESSION_PREFIX + base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The client name a session id carries, or null for one this server did not issue. */
export function clientNameOf(sessionId: string | null): string | null {
  if (!sessionId?.startsWith(SESSION_PREFIX)) return null;
  let name: string;
  try {
    const binary = atob(sessionId.slice(SESSION_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/"));
    name = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))).trim();
  } catch {
    return null;
  }
  // Control characters would not survive a header; a name with them is not ours.
  return name && name.length <= 64 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}
