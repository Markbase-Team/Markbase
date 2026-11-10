"use client";

import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { GoogleSignInButton } from "@/components/google-sign-in-button";

type Mode = "login" | "signup";

const COPY: Record<
  Mode,
  {
    title: string;
    subtitle: string;
    submit: string;
    pending: string;
    passwordAutoComplete: string;
    footerPrompt: string;
    footerCta: string;
    footerHref: string;
  }
> = {
  login: {
    title: "Welcome back",
    subtitle: "Sign in to your dashboard",
    submit: "Sign in with email",
    pending: "Signing in…",
    passwordAutoComplete: "current-password",
    footerPrompt: "Don't have an account?",
    footerCta: "Sign up",
    footerHref: "/signup",
  },
  signup: {
    title: "Create your account",
    subtitle: "Run your dev business from your phone",
    submit: "Create account",
    pending: "Creating account…",
    passwordAutoComplete: "new-password",
    footerPrompt: "Already have an account?",
    footerCta: "Log in",
    footerHref: "/login",
  },
};

// Shared auth screen in the Amplyo style: centered single column, brand block,
// "Continue with Google" at the top, an OR divider, then the email/password
// fallback, and a footer cross-link. One component drives both /login and
// /signup via `mode`.
export function AuthForm({
  mode,
  next = "/dashboard",
  eyebrow,
  title,
  subtitle,
  initialError,
  googleEnabled = true,
  footerHref,
}: {
  mode: Mode;
  next?: string;
  /** Where the footer cross-link goes, when the page knows better than the
   *  default — a team instance's /login sends an invited person to its sign-up
   *  with the invite code. A full href; `next` is not appended. */
  footerHref?: string;
  /** Whether this instance's Supabase project has the Google provider on
   *  (`authProviders()` on the server). Off: the button shows, disabled. */
  googleEnabled?: boolean;
  /** A failure that happened before this page loaded — the OAuth callback
   *  bouncing back with a reason. Shown in the same box as a form error. */
  initialError?: string;
  // Optional brand-block overrides — used by the share landing page to show the
  // doc invite ("<owner> invited you", the doc title) above the same sign-in UI.
  eyebrow?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
}) {
  const router = useRouter();
  const copy = COPY[mode];
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    const password = String(fd.get("password") ?? "");

    setLoading(true);
    const supabase = createSupabaseBrowserClient();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }
      // With email confirmation on, there's no session yet — prompt the user
      // to confirm. Otherwise they're signed in and we can continue.
      if (!data.session) {
        setNotice("Check your email to confirm your account, then log in.");
        return;
      }
      // Signed in right here, without the /auth/callback round trip that seeds
      // onboarding — so ask the server to seed before we land on the app.
      router.push(next);
      router.refresh();
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Same as signup above: this path never touches /auth/callback.
    router.push(next);
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm">
      {/* Brand */}
      <div className="mb-8 flex flex-col items-center text-center">
        <Image
          src="/logo.png"
          alt=""
          width={56}
          height={56}
          priority
          className="size-14 object-contain"
        />
        {eyebrow && (
          <p className="mt-6 text-sm font-medium text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1
          className={`${eyebrow ? "mt-2" : "mt-6"} text-2xl font-bold tracking-tight`}
        >
          {title ?? copy.title}
        </h1>
        <p className="mt-1 text-2xl font-bold tracking-tight text-muted-foreground">
          {subtitle ?? copy.subtitle}
        </p>
      </div>

      {/* Google — primary, at the top */}
      <GoogleSignInButton next={next} enabled={googleEnabled} />

      {/* OR divider */}
      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs font-medium text-muted-foreground">OR</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Email/password fallback */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="h-12 rounded-lg px-4 text-sm"
        />
        <Input
          name="password"
          type="password"
          required
          autoComplete={copy.passwordAutoComplete}
          placeholder="Your password"
          className="h-12 rounded-lg px-4 text-sm"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        <Button
          type="submit"
          variant="outline"
          className="h-12 w-full rounded-lg text-sm"
          disabled={loading}
        >
          {loading ? copy.pending : copy.submit}
        </Button>
      </form>

      {/* Footer cross-link */}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {copy.footerPrompt}{" "}
        <Link
          href={footerHref ?? `${copy.footerHref}?next=${encodeURIComponent(next)}`}
          className="font-medium text-foreground hover:underline"
        >
          {copy.footerCta}
        </Link>
      </p>
    </div>
  );
}
