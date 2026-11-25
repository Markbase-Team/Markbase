"use client";

import { useEffect } from "react";
import { appFunnel } from "@markbase/shared/analytics/funnel/onboarding";
import type { FunnelSource } from "@markbase/shared/analytics/funnel/events";
import { useIsDesktop } from "./use-is-desktop";

// Reports that someone opened the app, once a day per place it was opened:
// the browser, the desktop app, or inside an AI app's card. The server keeps
// the first of each day anyway ("app.open" is a daily funnel event); the note
// in local storage only saves asking again on every page load.

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Mount once in an app shell. `embedded`: the app is inside an AI app's card. */
export function ReportAppOpen({ embedded = false }: { embedded?: boolean }) {
  const desktop = useIsDesktop();
  useEffect(() => {
    const source: FunnelSource = embedded ? "mcp" : desktop ? "desktop" : "web";
    const key = `markbase:app-open:${source}`;
    try {
      if (window.localStorage.getItem(key) === today()) return;
      window.localStorage.setItem(key, today());
    } catch {
      // No storage (a locked-down frame): report anyway, the server keeps one a day.
    }
    appFunnel.track("app.open", source);
  }, [embedded, desktop]);
  return null;
}
