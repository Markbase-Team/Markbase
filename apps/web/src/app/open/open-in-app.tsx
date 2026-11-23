"use client";

import { useEffect, useState } from "react";
import { AppWindow, Globe } from "lucide-react";

/** How long the desktop app gets to take the link before the website opens instead. */
const APP_WAIT_MS = 1500;

/**
 * Hand the link to the desktop app, and open the website when nothing took
 * it. A page cannot ask whether an app is installed; what it can see is that
 * the app came forward — the page loses focus or is hidden — so that is the
 * signal, and its absence after a moment means "no app".
 *
 * The browser may ask before it opens an app ("Open Markbase?"), which also
 * takes focus from the page. Then nothing is decided for the person: both
 * buttons stay, and they choose.
 */
export function OpenInApp({ appLink, webPath }: { appLink: string; webPath: string }) {
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    let left = false;
    const leave = () => {
      left = true;
      setWaiting(false);
    };
    const onVisibility = () => {
      if (document.hidden) leave();
    };
    window.addEventListener("blur", leave);
    document.addEventListener("visibilitychange", onVisibility);
    window.location.href = appLink;
    const timer = window.setTimeout(() => {
      if (!left && !document.hidden) window.location.replace(webPath);
    }, APP_WAIT_MS);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("blur", leave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [appLink, webPath]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-sm text-muted-foreground">
        {waiting ? "Opening the Markbase app…" : "Didn't open? Choose where to continue."}
      </p>
      <a
        href={appLink}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#e5ff6e] px-4 text-sm font-semibold text-zinc-900 transition hover:brightness-95 active:scale-[0.98]"
      >
        <AppWindow className="size-4" />
        Open in the desktop app
      </a>
      <a
        href={webPath}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border bg-background px-4 text-sm font-medium transition hover:bg-muted"
      >
        <Globe className="size-4" />
        Continue in the browser
      </a>
    </div>
  );
}
