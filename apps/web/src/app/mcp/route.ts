import { NextResponse } from "next/server";
import { agentTools } from "@markbase/shared/docs/agent-tools";
import { EMBED_TOOLS, appApp } from "@markbase/shared/docs/apps/app-app";
import { docApp } from "@markbase/shared/docs/apps/doc-app";
import { startApp } from "@markbase/shared/docs/apps/start-app";
import { MCP_INSTRUCTIONS, MCP_PROMPTS } from "@markbase/shared/docs/onboarding";
import { forwardedCaller, offersToken } from "@markbase/server/caller";
import { signInChallenge } from "@markbase/server/mcp-oauth";
import { toolRequest, type Json } from "@markbase/shared/endpoint-tools";
import {
  MCP_SESSION_HEADER,
  answerMcp,
  clientNameIn,
  clientNameOf,
  sessionIdFor,
  type JsonObject,
  type McpHost,
} from "@markbase/shared/mcp-http";
import { authenticateAgent } from "@/lib/agent-auth";
import { embedEnabled } from "@/lib/embed";
import { instanceUrl } from "@/lib/instance-url";
import { noteMcpEvent } from "@/lib/user-analytics";

export const runtime = "nodejs";

// The hosted MCP server: the document tools at a URL, for an agent that cannot
// run `npx @markbase/cli mcp` — a chat app, a browser, a machine without Node.
// It is the same server (@markbase/shared/mcp-http) with the same tools; only
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
  // A client with no key is told where to sign in (see @markbase/server/mcp-oauth);
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

  // Where this instance's app shows documents. The cards open them there; a
  // card is built here because the address is the shell's to know.
  const documentsUrl = `${await instanceUrl()}/dashboard/documents`;
  const docUrlPrefix = `${documentsUrl}/`;

  const embed = embedEnabled();

  const host: McpHost = {
    name: "markbase-docs",
    version: "1.0.0",
    // The embed experiment (docs/embed-proof.md) adds the real app, full page,
    // as a card and its two tools — only while it is switched on.
    tools: () => (embed ? [...agentTools(), ...EMBED_TOOLS] : agentTools()),
    instructions: MCP_INSTRUCTIONS,
    // In an app that shows cards (Claude), a document and the "where to
    // begin" answer are drawn in the conversation. Everywhere else the same
    // tools answer with the same text.
    apps: [
      docApp(docUrlPrefix, embed ? new URL(documentsUrl).origin : undefined),
      startApp({ docUrlPrefix, documentsUrl }),
      ...(embed ? [appApp(new URL(documentsUrl).origin)] : []),
    ],
    prompts: MCP_PROMPTS,
    // What the client asked of this server itself. A tool call that reaches a
    // tool is recorded by the API that answers it, not here.
    onEvent: (event, asked) => noteMcpEvent(forwardedCaller(caller), clientName, event, asked),
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
