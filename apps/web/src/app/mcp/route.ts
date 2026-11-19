import { NextResponse } from "next/server";
import { agentTools } from "@markbase/docs/agent-tools";
import { offersToken } from "@markbase/node/caller";
import { signInChallenge } from "@markbase/node/mcp-oauth";
import { toolRequest, type Json } from "@markbase/protocol/endpoint-tools";
import {
  MCP_SESSION_HEADER,
  answerMcp,
  clientNameIn,
  clientNameOf,
  sessionIdFor,
  type JsonObject,
  type McpHost,
} from "@markbase/protocol/mcp-http";
import { authenticateAgent } from "@/lib/agent-auth";
import { instanceUrl } from "@/lib/instance-url";

export const runtime = "nodejs";

// The hosted MCP server: the document tools at a URL, for an agent that cannot
// run `npx @markbase/cli mcp` — a chat app, a browser, a machine without Node.
// It is the same server (@markbase/protocol/mcp-http) with the same tools; only
// the way in differs.
//
// A tool call is answered by calling this deployment's own API with the
// caller's key, exactly as the local server does from the agent's machine. It
// is a second request on purpose: the API's gate (src/proxy.ts) is the one
// place a caller is checked and capped, and a call made in-process would go
// round it.
//
// Streamable HTTP, stateless: every POST is answered with JSON, and there is
// no stream to hold open, so an idle agent costs nothing.

const CORS: { [name: string]: string } = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": `Authorization, Content-Type, X-Api-Key, ${MCP_SESSION_HEADER}, Mcp-Protocol-Version`,
  "Access-Control-Expose-Headers": `${MCP_SESSION_HEADER}, WWW-Authenticate`,
  "Access-Control-Max-Age": "86400",
};

function refusal(status: number, message: string, headers: { [name: string]: string } = {}): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message } },
    { status, headers: { ...CORS, ...headers } }
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// No stream is offered (GET) and there is no session to end (DELETE); the
// protocol's answer to both is 405.
function notOffered() {
  return new NextResponse(null, { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } });
}
export const GET = notOffered;
export const DELETE = notOffered;

export async function POST(req: Request) {
  // A key, never the browser's cookie: this URL is reachable from any page a
  // signed-in person has open, and a cookie would let that page act as them.
  // A client with no key is told where to sign in (see @markbase/node/mcp-oauth);
  // one that can only send a key is told the same thing in words.
  if (!offersToken(req)) {
    return refusal(401, "Sign in, or send 'Authorization: Bearer <api_key>'. Keys are made in the dashboard, under API keys.", {
      "WWW-Authenticate": signInChallenge(await instanceUrl()),
    });
  }
  const caller = await authenticateAgent(req, "read");
  if (!caller.ok) {
    return refusal(
      caller.status,
      caller.error,
      caller.status === 401 ? { "WWW-Authenticate": signInChallenge(await instanceUrl(), true) } : {}
    );
  }

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return refusal(400, "The body is not JSON.");
  }

  const origin = new URL(req.url).origin;
  const credentials: { [name: string]: string } = {};
  for (const name of ["authorization", "x-api-key"]) {
    const value = req.headers.get(name);
    if (value) credentials[name] = value;
  }
  const messages = Array.isArray(body) ? body : [body];
  const named = messages.map(clientNameIn).find((n) => n !== null) ?? null;
  const clientName = named ?? clientNameOf(req.headers.get(MCP_SESSION_HEADER));

  const host: McpHost = {
    name: "markbase-docs",
    version: "1.0.0",
    tools: agentTools,
    async call(tool, args: JsonObject) {
      const request = toolRequest(tool, args);
      const headers: { [name: string]: string } = { ...credentials };
      if (clientName) headers["X-MCP-Client"] = clientName;
      if (request.body !== undefined) headers["content-type"] = "application/json";
      const res = await fetch(`${origin}/api/v1${request.path}`, {
        method: request.method,
        headers,
        body: request.body,
      });
      return { ok: res.ok, status: res.status, body: await res.text() };
    },
  };

  const answers: JsonObject[] = [];
  for (const message of messages) {
    const answer = await answerMcp(message, host);
    if (answer) answers.push(answer);
  }

  const headers: { [name: string]: string } = { ...CORS };
  if (named) headers[MCP_SESSION_HEADER] = sessionIdFor(named);
  // Notifications only: accepted, and nothing to say.
  if (answers.length === 0) return new NextResponse(null, { status: 202, headers });
  return NextResponse.json(Array.isArray(body) ? answers : answers[0], { headers });
}
