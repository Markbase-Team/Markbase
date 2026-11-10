"use client";

import { useEffect, useRef } from "react";

// Desktop sign-in only. The user already authenticated (Google or email) moments
// ago in this same browser, and /cli-auth is the last hop before the app's
// loopback — so there's nothing to decide, and making them click "Sign in" again
// is pure friction. Submit the approve form automatically.
//
// The CLI path never renders this: there the capability choice IS the decision, so
// it stays a deliberate click.
export function AutoApprove({ formId }: { formId: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return; // StrictMode double-invoke must not double-submit
    done.current = true;
    const form = document.getElementById(formId);
    if (form instanceof HTMLFormElement) form.requestSubmit();
  }, [formId]);
  return null;
}
