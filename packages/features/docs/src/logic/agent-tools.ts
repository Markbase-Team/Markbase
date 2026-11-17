import { AGENT_ENDPOINTS, type DocEndpoint, type EndpointParam, type HttpMethod } from "./endpoints";

// The tools an agent may call, as data.
//
// A tool is an endpoint an agent is allowed to reach (endpoints.ts), said in
// the terms an agent's client needs: a name, when to use it, and how to send
// it. The server answers with this list at GET /agent/tools, and the MCP
// server asks for it when it starts — so a tool added, changed or withdrawn on
// the server reaches every agent with the next deploy, not the next release of
// the CLI. The copy built into the CLI is what it falls back on when the
// server cannot be reached.
//
// Everything a caller needs to make the request is in the tool: the method,
// the path with its `:params`, and the declared parameters. A client that has
// never heard of an endpoint can still call it.

/** Where the server answers with its tools, under /api/v1. */
export const AGENT_TOOLS_PATH = "/agent/tools";

export interface AgentTool {
  /** The endpoint's id; the tool's name. */
  name: string;
  description: string;
  method: HttpMethod;
  /** Under /api/v1, with `:name` for each path parameter. */
  path: string;
  /** Query (GET, DELETE) or JSON body (POST, PUT, PATCH) parameters. */
  params: EndpointParam[];
  /** It only reads. */
  readOnly: boolean;
  /** It removes something that cannot be brought back. */
  destructive: boolean;
}

function toolOf(e: DocEndpoint): AgentTool {
  return {
    name: e.id,
    description: e.skill ? `${e.summary} — ${e.skill.whenToUse}` : e.summary,
    method: e.method,
    path: e.path,
    // Said one way, so the list reads back exactly as it was sent.
    params: (e.params ?? []).map((p) => ({
      name: p.name,
      type: p.type,
      ...(p.required ? { required: true } : {}),
      ...(p.description ? { description: p.description } : {}),
    })),
    readOnly: e.method === "GET",
    destructive: e.destructive === true,
  };
}

/** Every tool, from the endpoint registry as this build has it. */
export function agentTools(): AgentTool[] {
  return AGENT_ENDPOINTS.map(toolOf);
}

/** The `:name` parameters of a path, in order. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(/:(\w+)/g)].map((m) => m[1]);
}

/** One property of a tool's input, as JSON Schema. */
export interface ToolProperty {
  type?: "string" | "number" | "boolean";
  description?: string;
}

/** A tool's input, as the JSON Schema an MCP client is given. */
export interface ToolInputSchema {
  type: "object";
  properties: { [name: string]: ToolProperty };
  required: string[];
}

/** The input schema of a tool: its path parameters, then its declared ones. */
export function toolInputSchema(tool: AgentTool): ToolInputSchema {
  const properties: { [name: string]: ToolProperty } = {};
  const required: string[] = [];
  for (const name of pathParams(tool.path)) {
    properties[name] = { type: "string", description: "path parameter" };
    required.push(name);
  }
  for (const p of tool.params) {
    properties[p.name] =
      p.type === "json"
        ? { description: p.description ?? "JSON value" }
        : { type: p.type, ...(p.description ? { description: p.description } : {}) };
    if (p.required) required.push(p.name);
  }
  return { type: "object", properties, required };
}

const METHODS: readonly string[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const PARAM_TYPES: readonly string[] = ["string", "number", "boolean", "json"];

/** Any JSON value — what a server's answer is before it is checked. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function isRecord(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function paramOf(value: Json): EndpointParam | null {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.type !== "string") return null;
  if (!PARAM_TYPES.includes(value.type)) return null;
  return {
    name: value.name,
    type: value.type as EndpointParam["type"],
    ...(value.required === true ? { required: true } : {}),
    ...(typeof value.description === "string" ? { description: value.description } : {}),
  };
}

function toolFrom(value: Json): AgentTool | null {
  if (!isRecord(value)) return null;
  const { name, description, method, path, params } = value;
  if (typeof name !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) return null;
  if (typeof description !== "string" || typeof path !== "string" || !path.startsWith("/")) return null;
  if (typeof method !== "string" || !METHODS.includes(method)) return null;
  const list = Array.isArray(params) ? params.map(paramOf) : [];
  if (list.some((p) => p === null)) return null;
  return {
    name,
    description,
    method: method as HttpMethod,
    path,
    params: list.filter((p): p is EndpointParam => p !== null),
    readOnly: typeof value.readOnly === "boolean" ? value.readOnly : method === "GET",
    destructive: value.destructive === true,
  };
}

/**
 * Read a server's answer to GET /agent/tools. Null when it is not a list of
 * tools this client can call — an old server, an error page — so the caller
 * keeps the list it was built with rather than offering nothing.
 */
export function parseAgentTools(body: string): AgentTool[] | null {
  let parsed: Json;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tools)) return null;
  const tools = parsed.tools.map(toolFrom);
  if (tools.length === 0 || tools.some((t) => t === null)) return null;
  return tools.filter((t): t is AgentTool => t !== null);
}
