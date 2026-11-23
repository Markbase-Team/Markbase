import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { EMBED_COOKIE_OPTIONS, EMBED_MARKER_COOKIE } from "@markbase/shared/embed-cookies";
import { openEmbedCode } from "@markbase/server/mcp-oauth";
import { embedEnabled } from "@/lib/embed";
import { instanceUrl } from "@/lib/instance-url";
import { oauthSecret } from "@/lib/mcp-oauth";

export const runtime = "nodejs";

function refusal(message: string): NextResponse {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Markbase</title>
<body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;font-family:system-ui;color:#141413;background:#fff">
<p style="max-width:22rem;text-align:center;font-size:14px;line-height:1.5">${message}</p></body>`;
  return new NextResponse(html, { status: 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

// GET /embed?code=… — where a card's frame is signed in (docs/embed-proof.md).
// The code is a one-minute hand-off from POST /api/v1/me/embed/session; its
// magic-link token becomes this frame's session. The session cookies are
// embed cookies (SameSite=None; Secure; Partitioned): they live in this frame
// under the site that framed it, and the person's own markbase.so session is
// left alone. The marker beside them tells the server, on later requests from
// the frame, to keep writing embed cookies.
// Experiment: 404 unless the embed is switched on (@/lib/embed).
export async function GET(req: NextRequest) {
  if (!embedEnabled()) return new NextResponse("Not found", { status: 404 });
  const grant = openEmbedCode(req.nextUrl.searchParams.get("code"), oauthSecret());
  if (!grant) return refusal("This link has expired. Ask your assistant to open Markbase again.");

  const response = NextResponse.redirect(`${await instanceUrl()}${grant.next}`, { headers: { "cache-control": "no-store" } });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: EMBED_COOKIE_OPTIONS,
    cookies: {
      getAll: () => [],
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, ...EMBED_COOKIE_OPTIONS }));
      },
    },
  });
  const { data, error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: grant.tokenHash });
  if (error || data.user?.id !== grant.userId) {
    return refusal("This link has already been used or has expired. Ask your assistant to open Markbase again.");
  }
  response.cookies.set(EMBED_MARKER_COOKIE, "1", { ...EMBED_COOKIE_OPTIONS, httpOnly: true, path: "/" });
  return response;
}
