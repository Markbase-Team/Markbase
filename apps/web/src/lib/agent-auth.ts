import { NextResponse } from "next/server";
import {
  resolveCaller,
  type Caller,
  type ApiScope,
} from "@markbase/node/caller";
import { getCurrentUser } from "@/lib/supabase/server";

// This shell's half of the auth seam.
//
// Resolving a caller is shared logic and lives in @markbase/node/caller; what
// stays here is the part only a Next app can do — reading the cookie session
// through `next/headers`, and writing a NextResponse. Another shell supplies
// its own session reader and reuses everything else.

export type AgentAuth = Caller;

// Agents may call the API from anywhere; allow cross-origin use. Only the API
// key (or a signed-in session) grants access — CORS is not the gate.
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  // PATCH is how a title or a path changes; without it here the preflight
  // fails and the desktop app (origin markbase://app) can never rename a doc.
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Api-Key",
  "Access-Control-Max-Age": "86400",
};

/**
 * Authorize a request against this shell.
 *
 * Passes for a signed-in user (cookie session) OR a valid API key carrying the
 * required scope. Either way it yields `ownerId` — whose data the request may
 * reach — so callers scope by that and never learn which path was taken.
 */
export function authenticateAgent(
  req: Request,
  need: ApiScope
): Promise<AgentAuth> {
  return resolveCaller(req, need, getCurrentUser);
}

// JSON response with CORS headers (use for all /api/v1 responses).
export function agentJson<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

// 204 preflight response for the OPTIONS handler.
export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
