import { confirmApiKey } from "@markbase/server/api-keys";
import { openCode, pkceMatches } from "@markbase/server/mcp-oauth";
import { oauthError, oauthJson, oauthPreflight, oauthSecret } from "@/lib/mcp-oauth";

export const runtime = "nodejs";

// The last step of sign-in for /mcp: the client trades its code, with the
// proof that it is the one that asked for it, for the API key.
//
// The key was minted inert when the person approved. Confirming it here is
// what makes it work, and confirming works once, so a code that is replayed
// or stolen after use gets nothing.
export const OPTIONS = oauthPreflight;

const refused = (description: string) => oauthError({ error: "invalid_grant", error_description: description });

async function fields(req: Request): Promise<URLSearchParams> {
  const text = await req.text();
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const parsed: { [name: string]: string } = JSON.parse(text);
    return new URLSearchParams(parsed);
  }
  return new URLSearchParams(text);
}

export async function POST(req: Request) {
  let form: URLSearchParams;
  try {
    form = await fields(req);
  } catch {
    return oauthError({ error: "invalid_request", error_description: "The body could not be read." });
  }
  if (form.get("grant_type") !== "authorization_code") {
    return oauthError({ error: "unsupported_grant_type", error_description: "Only authorization_code is offered." });
  }

  const grant = openCode(form.get("code"), oauthSecret());
  if (!grant) return refused("The code is not valid or has expired. Start the sign-in again.");
  if (form.get("client_id") !== grant.clientId) return refused("The code was issued to another client.");
  const redirectUri = form.get("redirect_uri");
  if (redirectUri !== null && redirectUri !== grant.redirectUri) return refused("The redirect URI is not the one the code was issued for.");
  if (!pkceMatches(form.get("code_verifier"), grant.challenge)) return refused("The code verifier does not match.");

  if (!(await confirmApiKey(grant.token))) return refused("The code has already been used.");
  // No expiry and no refresh token: the key works until its owner revokes it
  // in the dashboard, like every other key.
  return oauthJson({ access_token: grant.token, token_type: "Bearer" });
}
