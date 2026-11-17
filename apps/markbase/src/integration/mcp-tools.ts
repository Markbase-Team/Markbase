import { AGENT_ENDPOINTS, type DocEndpoint } from "@markbase/docs/endpoints";
import { pathParams } from "./call";

// The tools `markbase mcp` lists, apart from the server that serves them so
// the list can be read (and tested) without starting one.

/** One argument of a tool. No `type` means any JSON value. */
export interface McpToolProperty {
  type?: string;
  description?: string;
}

/** A tool's arguments, as JSON Schema. */
export interface McpToolInput {
  type: "object";
  properties: Record<string, McpToolProperty>;
  required: string[];
}

/** A tool as the MCP server lists it. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: McpToolInput;
}

// JSON Schema for a tool: path params (required strings) + declared params.
function inputSchema(e: DocEndpoint): McpToolInput {
  const properties: Record<string, McpToolProperty> = {};
  const required: string[] = [];
  for (const name of pathParams(e.path)) {
    properties[name] = { type: "string", description: "path parameter" };
    required.push(name);
  }
  for (const p of e.params ?? []) {
    properties[p.name] =
      p.type === "json"
        ? { description: p.description ?? "JSON value" }
        : { type: p.type, description: p.description };
    if (p.required) required.push(p.name);
  }
  return { type: "object", properties, required };
}

/**
 * Every tool the server offers: one per agent endpoint in the registry, so an
 * endpoint that is registered is a tool with nothing written here.
 */
export function mcpTools(): McpTool[] {
  return AGENT_ENDPOINTS.map((e) => ({
    name: e.id,
    description: e.skill ? `${e.summary} — ${e.skill.whenToUse}` : e.summary,
    inputSchema: inputSchema(e),
  }));
}
