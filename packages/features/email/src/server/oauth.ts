import crypto from "node:crypto";
import { encryptToken } from "./crypto";
import { upsertEmailAccount } from "./accounts";

// Google OAuth helpers for connecting a Gmail account. Keeps the Next.js route
// handlers thin: they just manage cookies/redirects and call these.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GMAIL_SCOPES = [
  "openid",
  "email",
  // modify = read + change labels (mark read/unread, archive). Superset of
  // readonly; still cannot send or permanently delete.
  "https://www.googleapis.com/auth/gmail.modify",
].join(" ");

export function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

// Build the Google consent URL. `access_type=offline` + `prompt=consent` ensure
// a refresh token is returned every time.
export function buildConsentUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new Error(
      "Google OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_OAUTH_REDIRECT_URI)"
    );
  }
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  // Deliberately NOT setting include_granted_scopes: we request all the scopes
  // we need in this single flow, and incremental auth would otherwise surface
  // unrelated scopes previously granted to this OAuth client (e.g. analytics).
  url.searchParams.set("state", state);
  return url.toString();
}

type GoogleCodeTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleIdTokenClaims = {
  sub?: string;
  email?: string;
  name?: string;
};

function decodeIdToken(idToken: string): GoogleIdTokenClaims {
  const part = idToken.split(".")[1] ?? "";
  const claims: GoogleIdTokenClaims = JSON.parse(
    Buffer.from(part, "base64url").toString("utf8")
  );
  return claims;
}

// Exchange an auth code for tokens, then store the account (encrypted refresh
// token, upserted on email). Returns the connected address for the redirect.
export async function connectGmailAccount(code: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth not configured");
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json: GoogleCodeTokenResponse = await res.json();
  if (!res.ok || !json.refresh_token || !json.id_token) {
    throw new Error(
      `OAuth exchange failed: ${
        json.error_description ??
        json.error ??
        "no refresh token returned (re-consent required)"
      }`
    );
  }

  const claims = decodeIdToken(json.id_token);
  if (!claims.email) throw new Error("OAuth exchange returned no email");

  await upsertEmailAccount({
    email_address: claims.email,
    google_sub: claims.sub ?? null,
    display_name: claims.name ?? null,
    refresh_token_enc: encryptToken(json.refresh_token),
    scopes: json.scope ? json.scope.split(" ") : [],
  });

  return claims.email;
}
