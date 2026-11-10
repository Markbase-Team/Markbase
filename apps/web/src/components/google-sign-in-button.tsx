"use client";

import { useState } from "react";
import { Button } from "@markbase/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// "Continue with Google" CTA (Amplyo login style). Kicks off Supabase's OAuth
// flow; requires the Google provider to be enabled on the Supabase project
// (Auth → Providers) and this app's /auth/callback added to the allowed
// redirect URLs. Errors surface inline. A self-hosted instance whose project
// has no Google provider passes `enabled={false}` (the page asks GoTrue): the
// button stays where it always is, greyed out, and says why — so nobody clicks
// into "Unsupported provider" and the email form below is the obvious way in.
export function GoogleSignInButton({
  next = "/dashboard",
  enabled = true,
}: {
  next?: string;
  /** The Google provider is on for this instance's Supabase project. */
  enabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The desktop handed the flow to the system browser; finish it there.
  const [handedOff, setHandedOff] = useState(false);

  async function signIn() {
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

    // Inside the desktop app, Google OAuth CANNOT run embedded (Google refuses a
    // webview) AND cannot be started here at all: PKCE stores a code_verifier in
    // THIS window, but the exchange happens in the system browser where Google
    // lands — a different browser, no verifier, failure. So hand the WHOLE flow to
    // the system browser: open /auth/google there, which starts OAuth in that
    // browser so the verifier and the exchange share one. The `next` carries the
    // desktop loopback chain (/auth/callback → /cli-auth → approve → loopback). On
    // the web this branch never runs.
    const inElectron = /\bElectron\//.test(navigator.userAgent);
    if (inElectron) {
      window.open(`${window.location.origin}/auth/google?next=${encodeURIComponent(next)}`, "_blank");
      // Deliberately NOT re-enabled. The flow now lives in the system browser, and
      // this window has no way to know how it is going — so the button used to
      // come straight back to life and invite a second click. Clicking again
      // starts a second OAuth flow whose PKCE verifier overwrites the first, and
      // then NEITHER can complete: "Unable to exchange external code". Retrying
      // made it permanently worse, which is the opposite of what a button that
      // looks ready should do. Say where the flow went instead.
      setHandedOff(true);
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        onClick={signIn}
        disabled={!enabled || loading || handedOff}
        className="h-12 w-full gap-2 rounded-lg text-sm"
      >
        <GoogleG />
        {handedOff
          ? "Continue in your browser…"
          : loading
            ? "Redirecting…"
            : "Continue with Google"}
      </Button>
      {!enabled && (
        <p className="text-sm text-muted-foreground">
          Google sign-in is not enabled on this instance. Use your email and
          password below.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09 0-.73.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
