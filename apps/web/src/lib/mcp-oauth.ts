import { NextResponse } from "next/server";
import { serverSupabaseKey } from "@markbase/protocol/supabase";
import type { OAuthError } from "@markbase/server/mcp-oauth";

// The web app's half of sign-in for the hosted MCP server: where the secret
// comes from, and how its endpoints answer. The rules are in
// @markbase/server/mcp-oauth.

/**
 * The secret client ids are signed with and codes are sealed with. It is
 * derived from the server's Supabase key, which every instance already has
 * and only the server holds, so a self-hosted instance has nothing to set.
 */
export function oauthSecret(): string {
  const secret = serverSupabaseKey();
  if (!secret) throw new Error("No server Supabase key: sign-in for /mcp cannot sign anything.");
  return secret;
}

// These endpoints are called by other sites' servers and by browser-based
// clients; none of them reads a cookie, so any origin may call them.
export const OAUTH_CORS: { [name: string]: string } = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function oauthJson<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { ...OAUTH_CORS, "Cache-Control": "no-store" } });
}

export function oauthError(error: OAuthError, status = 400): NextResponse {
  return oauthJson({ error: error.error, error_description: error.error_description }, status);
}

export function oauthPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: OAUTH_CORS });
}
