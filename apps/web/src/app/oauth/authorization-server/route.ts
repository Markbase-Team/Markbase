import { authorizationServerMetadata } from "@markbase/node/mcp-oauth";
import { instanceUrl } from "@/lib/instance-url";
import { oauthJson, oauthPreflight } from "@/lib/mcp-oauth";

export const runtime = "nodejs";

// RFC 8414. Where an MCP client registers, sends the person to approve, and
// exchanges its code. Served at /.well-known/oauth-authorization-server by a
// rewrite in next.config.ts.
export const OPTIONS = oauthPreflight;

export async function GET() {
  return oauthJson(authorizationServerMetadata(await instanceUrl()));
}
