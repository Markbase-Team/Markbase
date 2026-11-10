import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/routes";

export const runtime = "nodejs";

// Session-establishing redirect. Two ways in, one job (write the session cookie):
//   • OAuth (Google) sends a `code` → exchangeCodeForSession.
//   • The desktop app sends a magic-link `token_hash` → verifyOtp. Its window
//     loads this after the system browser authorized it (roadmap C4), so no login
//     page is ever shown inside Electron.
// Supabase must list this URL under Auth → URL Configuration → Redirect URLs.
//
// The session cookies are written directly onto the redirect response (not via
// the next/headers cookie store) — Set-Cookie headers from that store are not
// reliably merged onto a fresh NextResponse.redirect(), which would drop the
// session and bounce the user straight back to /login.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const nextParam = searchParams.get("next");
  const next = safeNext(nextParam);
  // The provider can refuse before we ever see a code, and it says why.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");

  let failed: string | null = null;
  if (code || tokenHash) {
    const response = NextResponse.redirect(`${origin}${next}`);
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );
    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash })
      : await supabase.auth.exchangeCodeForSession(code as string);
    if (error) failed = error.message;
    // No onboarding here any more. The Welcome document is created in the
    // account's first vault when that vault is created (POST /api/v1/vaults),
    // which is the first moment there is somewhere for it to live — and which
    // every client reaches, where this callback was only ever one way in.
    if (!error) return response;
  }

  // Carry the reason. "Could not sign in" was all anyone ever saw, while the
  // actual answer — "Unable to exchange external code", which means the PKCE
  // verifier did not match because a second OAuth flow had overwritten it — sat
  // in a query parameter we dropped on the floor. A sign-in that fails should say
  // what failed, both to the user and to the server log.
  const reason = providerError ?? failed ?? "Could not sign in";
  console.warn(`[auth/callback] sign-in failed: ${reason}`);
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);
}
