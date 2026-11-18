import type { HttpMethod } from "@markbase/docs/endpoints";
import { pathParams } from "@markbase/docs/agent-tools";
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
  params: Record<string, unknown>,
  // The MCP server forwards, when known: the connecting client's name (so the
  // API records which provider this key is) and the session token (so doc
  // actions attribute to a specific agent session).
  // And the key to send, when it has already worked out which one (see
  // mcp-auth); `markbase api` leaves it out and gets the configured key.
  opts: { clientName?: string; sessionToken?: string; apiKey?: string } = {}
): Promise<CallResult> {
  const rest = { ...params };

  let path = ep.path;
  for (const name of pathParams(ep.path)) {
    if (rest[name] == null || rest[name] === "") {
      throw new Error(`Missing path param: ${name}`);
    }
    path = path.replace(`:${name}`, encodeURIComponent(String(rest[name])));
    delete rest[name];
  }

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
  let url = base + path;
  const init: RequestInit = { method: ep.method, headers };
  if (ep.method === "POST" || ep.method === "PUT" || ep.method === "PATCH") {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(rest);
  } else if (Object.keys(rest).length) {
    const qs = new URLSearchParams(
      Object.entries(rest).map(([k, v]) => [k, String(v)] as [string, string])
    );
    url += `?${qs.toString()}`;
  }

  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, body: await res.text() };
}
