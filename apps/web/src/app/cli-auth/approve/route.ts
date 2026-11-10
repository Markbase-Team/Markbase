import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createApiKey } from "@markbase/node/api-keys";
import { getCurrentUser } from "@/lib/supabase/server";
import { CAPABILITIES, DEFAULT_CAPABILITY, isLoopbackCallback } from "../page";

export const runtime = "nodejs";

// POST target of the `/cli-auth` approve form. Mints an API key for the
// signed-in user and redirects it back to the CLI's loopback callback with the
// state nonce. The key only ever travels to localhost.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const callback = form.get("callback");
  const state = form.get("state");
  if (typeof callback !== "string" || !isLoopbackCallback(callback)) {
    return NextResponse.json({ error: "Invalid callback" }, { status: 400 });
  }

  // The capability is this machine's ceiling on your documents — the security
  // boundary. Anything an agent on this machine does is capped here, and no
  // header/session trick can widen it. "owner" is stored as null (full access).
  // Desktop sign-in is the user acting as themselves — full access to their own
  // account, no ceiling. The CLI path caps agents on a (possibly shared) machine,
  // so it honours the picked capability.
  const desktop = form.get("desktop") === "1";
  const picked = form.get("capability");
  const capability = desktop
    ? "owner"
    : typeof picked === "string" && (CAPABILITIES as readonly string[]).includes(picked)
      ? picked
      : DEFAULT_CAPABILITY;

  // The CLI probed `claude --version` on the machine and passed the result
  // through. Recording it on the key is what unlocks the Claude-Code-only
  // features (see @markbase/protocol features.ts); the worker refreshes it later.
  const probed = form.get("claude");
  const claudeVersion =
    typeof probed === "string" && probed.trim() ? probed.trim().slice(0, 100) : null;

  // No User-Agent in the name. This form POST comes from the BROWSER, so the
  // header was never the CLI's — it produced names like
  // "markbase CLI · 2026-07-10 · Mozilla/5.0 (Macintosh; Intel Mac OS X 1",
  // which is what a history entry would otherwise be attributed to. The tool a
  // connection belongs to is settled by its stamped provider (see
  // setConnectionProvider), so the stored name is only ever a fallback.
  const source = desktop ? "Markbase Desktop" : "markbase CLI";
  // A client that says confirm=1 will call /api/v1/keys/confirm once the key
  // reaches it, so mint it inert. Until then it authenticates nothing and the
  // sweep deletes it — which is what makes an abandoned authorization harmless
  // rather than a live full-access credential parked in a browser's history.
  const requiresConfirmation = form.get("confirm") === "1";
  const { token } = await createApiKey({
    name: `${source} · ${new Date().toISOString().slice(0, 10)}`,
    ownerId: user.id,
    ownerEmail: user.email ?? null,
    capability: capability === "owner" ? null : capability,
    claudeVersion,
    requiresConfirmation,
  });

  const url = new URL(callback);
  url.searchParams.set("key", token);
  if (typeof state === "string") url.searchParams.set("state", state);

  // Desktop mode: the WINDOW needs its own session (a cookie), not just the
  // daemon's key. Mint a single-use magic-link token for the SAME signed-in user;
  // the app loads /auth/callback with it to establish the session in its window.
  // The token is short-lived and one-time, and only ever travels to localhost.
  if (form.get("desktop") === "1" && user.email) {
    try {
      const admin = createClient(
        process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
        { auth: { persistSession: false } }
      );
      const { data, error } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: user.email,
      });
      if (!error && data.properties?.hashed_token) {
        url.searchParams.set("session", data.properties.hashed_token);
      }
    } catch {
      // No session hand-back — the app can still fall back to its own login.
    }
  }

  return NextResponse.redirect(url.toString(), 303);
}
