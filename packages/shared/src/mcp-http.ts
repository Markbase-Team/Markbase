// The MCP server, as messages: what both of its doors answer.
//
// There is one server and two ways in. The hosted `/mcp` route is for an agent
// with no machine of ours to run a command on — a chat app, a browser — and
// takes one message per HTTP request. `markbase mcp` lives with the agent and
// takes one message per line on stdin. Both hand each message to `answerMcp`,
// so a client sees the same server whichever way it came, and a fix or a new
// method lands in both at once.
//
// It is written as a function from one JSON-RPC message to its answer, with no
// transport in it, so each door stays a few lines and this can be tested
// without a server.
//
// Stateless on purpose. Every message is answered from the message alone, so
// any instance can answer any request and nothing is held between them. The
// one thing a later request needs from an earlier one is the client's name
// (it is only said in `initialize`, and history attributes edits with it), so
// that travels in the session id the client sends back with each request.

import { toolAnnotations, toolInputSchema, type AgentTool, type Json } from "./endpoint-tools";

/** MCP protocol revisions this server answers, newest first. */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  // Older clients on stdio still ask for these; what this server answers is
  // the same under all five.
  "2024-11-05",
  "2024-10-07",
];

/** The header a client repeats on every request after `initialize`. */
export const MCP_SESSION_HEADER = "Mcp-Session-Id";

export type JsonObject = { [key: string]: Json };

/** What an API call answered, as the tool result is built from it. */
export interface ToolAnswer {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * What a client asked of the server itself, as opposed to of a tool: it said
 * hello, it listed the tools, or it asked for a tool or a method that does not
 * exist. A tool call that reaches a tool is not one of these — the API that
 * answers it is where that is seen.
 */
export const MCP_PROTOCOL_EVENTS = [
  "initialize",
  "tools_list",
  "unknown_tool",
  "unknown_method",
  // A client fetched a card's page (`asked` is its uri): the card is about to
  // be shown to a person.
  "resources_read",
  // A client listed the starters, and a person picked one (`asked` is its name).
  "prompts_list",
  "prompts_get",
] as const;
export type McpProtocolEvent = (typeof MCP_PROTOCOL_EVENTS)[number];

/** The MIME type that says a resource is an MCP App's page. */
export const MCP_APP_MIME = "text/html;profile=mcp-app";

/**
 * A card shown in the conversation in place of a tool's raw answer (MCP Apps,
 * the `io.modelcontextprotocol/ui` extension). The page is one self-contained
 * HTML document the agent's app runs in a sandboxed frame and hands the
 * tool's answer to. A client that does not know the extension ignores the
 * link and shows the same text answer as before.
 */
export interface McpApp {
  /** `ui://…`: what a tool points at, and what the client asks to read. */
  uri: string;
  name: string;
  description: string;
  /** The tools whose answer this card shows. */
  tools: readonly string[];
  /** The whole page. */
  html: string;
}

/** A starter a person can pick in their agent's app: it becomes their message. */
export interface McpPrompt {
  name: string;
  title: string;
  description: string;
  /** What is sent as the person's message. */
  text: string;
}

/** What the route supplies: who this server is, its tools, and how one is run. */
export interface McpHost {
  name: string;
  version: string;
  /** The tools on offer. May be asked of a server, so it may take a moment. */
  tools(): AgentTool[] | Promise<AgentTool[]>;
  /**
   * Run one tool. An answer that is not `ok` is shown with its status; to say
   * something else instead (there is no key yet, sign in here), throw an Error
   * and its message is the whole of what the agent is told.
   */
  call(tool: AgentTool, args: JsonObject): Promise<ToolAnswer>;
  /** What the agent is told about this server when it connects. */
  instructions?: string;
  /** Cards for tools' answers. With none, the server offers no resources. */
  apps?: readonly McpApp[];
  /** Starters. With none, the server offers no prompts. */
  prompts?: readonly McpPrompt[];
  /**
   * Told of each protocol event, if the host wants to know. `asked` is the
   * tool or method that was asked for and is not there. Must not throw.
   */
  onEvent?(event: McpProtocolEvent, asked?: string): void;
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
  const tool = (await host.tools()).find((t) => t.name === params.name);
  if (!tool) {
    host.onEvent?.("unknown_tool", typeof params.name === "string" ? params.name : undefined);
    return toolResult(`Unknown tool: ${String(params.name)}`, true);
  }
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
 * The link from a tool to the card that shows its answer, as tool metadata.
 * Both spellings: the nested one is the extension's, the flat one is what
 * earlier clients read.
 */
function appLink(tool: string, host: McpHost): JsonObject {
  const app = host.apps?.find((a) => a.tools.includes(tool));
  return app ? { _meta: { ui: { resourceUri: app.uri }, "ui/resourceUri": app.uri } } : {};
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
      host.onEvent?.("initialize");
      const protocolVersion =
        typeof asked === "string" && MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return result(id, {
        protocolVersion,
        capabilities: {
          tools: {},
          ...(host.apps?.length ? { resources: {} } : {}),
          ...(host.prompts?.length ? { prompts: {} } : {}),
        },
        serverInfo: { name: host.name, version: host.version },
        ...(host.instructions ? { instructions: host.instructions } : {}),
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      host.onEvent?.("tools_list");
      return result(id, {
        tools: (await host.tools()).map((t) => ({
          name: t.name,
          title: toolAnnotations(t).title,
          description: t.description,
          // The schema is plain JSON; the cast only tells TypeScript so.
          inputSchema: JSON.parse(JSON.stringify(toolInputSchema(t))) as JsonObject,
          annotations: { ...toolAnnotations(t) },
          ...appLink(t.name, host),
        })),
      });
    case "tools/call":
      return result(id, await callTool(params, host));
    case "resources/list":
      if (!host.apps?.length) break;
      return result(id, {
        resources: host.apps.map((app) => ({
          uri: app.uri,
          name: app.name,
          description: app.description,
          mimeType: MCP_APP_MIME,
        })),
      });
    case "resources/templates/list":
      if (!host.apps?.length) break;
      return result(id, { resourceTemplates: [] });
    case "resources/read": {
      if (!host.apps?.length) break;
      const app = host.apps.find((a) => a.uri === params.uri);
      if (!app) return failure(id, -32002, `Resource not found: ${String(params.uri)}`);
      host.onEvent?.("resources_read", app.uri);
      return result(id, {
        contents: [
          {
            uri: app.uri,
            mimeType: MCP_APP_MIME,
            text: app.html,
            // Nothing is loaded from outside the page, so it asks for no
            // domains: the client's default policy (no network) is the right one.
            _meta: { ui: { prefersBorder: true } },
          },
        ],
      });
    }
    case "prompts/list":
      if (!host.prompts?.length) break;
      host.onEvent?.("prompts_list");
      return result(id, {
        prompts: host.prompts.map((p) => ({ name: p.name, title: p.title, description: p.description })),
      });
    case "prompts/get": {
      if (!host.prompts?.length) break;
      const prompt = host.prompts.find((p) => p.name === params.name);
      if (!prompt) return failure(id, -32602, `Unknown prompt: ${String(params.name)}`);
      host.onEvent?.("prompts_get", prompt.name);
      return result(id, {
        description: prompt.description,
        messages: [{ role: "user", content: { type: "text", text: prompt.text } }],
      });
    }
    default:
      break;
  }
  // Not a method this server has, or one it has nothing to offer for: a
  // server with no cards answers `resources/*` as it did before it had any.
  host.onEvent?.("unknown_method", method);
  return failure(id, -32601, `Method not found: ${method}`);
}

/**
 * Answer one line of a stdio transport: a JSON-RPC message, or a batch of
 * them, as text. Null when there is nothing to send back (a notification, a
 * blank line). `seen` is shown each message before it is answered, for a
 * caller that needs something from it — the client's name in `initialize`.
 */
export async function answerMcpLine(
  line: string,
  host: McpHost,
  seen?: (message: Json) => void
): Promise<string | null> {
  if (!line.trim()) return null;
  let parsed: Json;
  try {
    parsed = JSON.parse(line);
  } catch {
    return JSON.stringify(failure(null, -32700, "Parse error: the line is not JSON."));
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const answers: JsonObject[] = [];
  for (const message of messages) {
    seen?.(message);
    const answer = await answerMcp(message, host);
    if (answer) answers.push(answer);
  }
  if (answers.length === 0) return null;
  return JSON.stringify(Array.isArray(parsed) ? answers : answers[0]);
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
