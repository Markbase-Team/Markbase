import { registerClient, type RegistrationRequest } from "@markbase/node/mcp-oauth";
import { oauthError, oauthJson, oauthPreflight, oauthSecret } from "@/lib/mcp-oauth";

export const runtime = "nodejs";

// RFC 7591. An MCP client introduces itself before it sends anybody to sign
// in. Nothing is stored: the id returned is the registration, signed (see
// @markbase/node/mcp-oauth), so this is open to any caller and costs nothing
// to call. A registration grants nothing; a person still has to approve.
export const OPTIONS = oauthPreflight;

export async function POST(req: Request) {
  let body: RegistrationRequest;
  try {
    body = await req.json();
  } catch {
    return oauthError({ error: "invalid_client_metadata", error_description: "The body is not JSON." });
  }
  const registered = registerClient(body ?? {}, oauthSecret());
  if (!registered.ok) return oauthError(registered);
  return oauthJson(
    {
      client_id: registered.clientId,
      client_name: registered.client.name,
      redirect_uris: registered.client.redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201
  );
}
