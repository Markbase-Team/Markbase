"use client";

import { useSyncExternalStore } from "react";

/**
 * True when running inside the Markbase desktop (Electron) window.
 *
 * Detected from the user agent, the same signal the Google sign-in button uses
 * to decide whether to hand OAuth to the system browser. Starts `false` and
 * flips after mount, so server and first client render agree (no hydration
 * mismatch) and desktop-only affordances light up a tick later.
 */
export function useIsDesktop(): boolean {
  // False on the server and through hydration, the real answer immediately after
  // — stated as a server snapshot and a client one rather than as a state an
  // effect corrects. There is nothing to subscribe to: a browser does not stop
  // being Electron.
  return useSyncExternalStore(
    () => () => {},
    () => /\bElectron\//.test(navigator.userAgent),
    () => false
  );
}
