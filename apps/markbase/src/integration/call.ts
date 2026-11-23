import type { HttpMethod } from "@markbase/shared/docs/endpoints";
import { pathParams } from "@markbase/shared/docs/agent-tools";
import { toolRequest, type Json } from "@markbase/shared/endpoint-tools";
import { appUrl, loadConfig } from "../config";

// Build + send a request for a registry endpoint from a flat param map. Path
// params (`:id`) are filled from the map; the rest become the JSON body
// (POST/PUT/PATCH) or the query string (GET). Shared by the CLI (`markbase api`) and
// the MCP server so both hit the API identically.

export { pathParams };

export interface CallResult {
  ok: boolean;
  status: number;
  body: string;
}

export async function callEndpoint(
  ep: { method: HttpMethod; path: string },
  params: { [name: string]: Json },
  opts: {
    clientName?: string;
    sessionToken?: string;
    apiKey?: string;
    /** An MCP tool call: the API answers an agent leaner than the editor (docs_readDoc). */
    viaMcp?: boolean;
  } = {}
): Promise<CallResult> {
  const request = toolRequest(ep, params);

  const apiKey = opts.apiKey ?? loadConfig().apiKey;
  if (!apiKey) {
    throw new Error("No API key. Set MARKBASE_API_KEY, or run `markbase login`.");
  }
  const base = process.env.MARKBASE_API_BASE ?? `${appUrl()}/api/v1`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  if (opts.clientName) headers["X-MCP-Client"] = opts.clientName;
  if (opts.sessionToken) headers["X-MCP-Session"] = opts.sessionToken;
  if (opts.viaMcp) headers["X-MCP-Request"] = "1";
  const init: RequestInit = { method: request.method, headers };
  if (request.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = request.body;
  }

  const res = await fetch(base + request.path, init);
  return { ok: res.ok, status: res.status, body: await res.text() };
}
