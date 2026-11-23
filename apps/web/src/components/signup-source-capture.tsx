"use client";

import { useEffect } from "react";
import {
  SIGNUP_SOURCE_COOKIE,
  captureSource,
  parseSource,
  readSourceCookie,
  serializeSource,
  shouldReplace,
  sourceCookieAttributes,
} from "@markbase/shared/analytics/funnel/signup-source";

// Remembers how this browser first arrived, in a cookie the sign-up later
// reads (see @markbase/shared/analytics/funnel/signup-source). Mounted once in the root layout so the
// first page of a visit — landing, blog post, shared document — is the one
// that counts; it renders nothing.
export function SignupSourceCapture() {
  useEffect(() => {
    try {
      const existing = parseSource(readSourceCookie(document.cookie));
      const incoming = captureSource({
        href: window.location.href,
        referrer: document.referrer,
        now: new Date(),
      });
      if (!incoming || !shouldReplace(existing, incoming)) return;
      const secure = window.location.protocol === "https:";
      document.cookie = `${SIGNUP_SOURCE_COOKIE}=${serializeSource(incoming)}; ${sourceCookieAttributes(secure)}`;
    } catch {
      // A browser that refuses cookies simply has no source to report.
    }
  }, []);
  return null;
}

/**
 * Tell the server the signed-in browser's source, after a sign-up that never
 * passes through /auth/callback (an email sign-up that is signed in at once,
 * or an invite-code join). Fire-and-forget: the account is made either way.
 */
export function reportSignupSource(): void {
  void fetch("/api/signup-source", { method: "POST", keepalive: true }).catch(() => undefined);
}
