import { protectedResourceMetadata } from "@markbase/server/mcp-oauth";
import { instanceUrl } from "@/lib/instance-url";
import { oauthJson, oauthPreflight } from "@/lib/mcp-oauth";

export const runtime = "nodejs";

// RFC 9728. An MCP client that /mcp refused asks here who signs people in for
// it. Served at /.well-known/oauth-protected-resource, and at that path
// followed by the resource's own (`…/mcp`), by the rewrites in next.config.ts:
// the app router does not route a folder whose name starts with a dot. Both
// get the one answer, since /mcp is the only resource.
export const OPTIONS = oauthPreflight;

export async function GET() {
  return oauthJson(protectedResourceMetadata(await instanceUrl()));
}
