"use client";

import { useEffect, useState } from "react";
import { useDocsPorts } from "./ports";

// "You are looking at a cached copy."
//
// On the desktop a document is served from a local snapshot first and refreshed
// from the cloud behind the answer, so opening is instant instead of costing a
// round trip. The cost is a window where the text on screen is out of date — a
// document edited on the web shows its old content until the refresh lands.
//
// That window is short. Measured against this project: ~400-600 ms warm, ~1.5 s
// cold. Announcing it immediately would therefore flash a badge on nearly every
// open and say nothing useful, so this waits QUIET_MS before admitting anything.
// A refresh that beats the threshold is invisible, which is the honest outcome —
// nothing was stale long enough to matter.
//
// The state that actually needed surfacing is `failed`. A refresh that errors
// used to be swallowed, leaving old text on screen permanently with no log line
// and no indicator. That one shows at once and stays.

/** Below this, a refresh is fast enough that saying anything is just flicker. */
const QUIET_MS = 400;

export type CachedCopyState = "fresh" | "checking" | "stale";

export function useCachedCopy(docId: string | null): CachedCopyState {
  const [state, setState] = useState<CachedCopyState>("fresh");
  // Reset on the render that changes document, not from the effect below: the
  // answer belongs to the doc being asked about, and an effect would report the
  // previous one's for a commit.
  const [stateFor, setStateFor] = useState(docId);
  if (stateFor !== docId) {
    setStateFor(docId);
    setState("fresh");
  }

  // Only a host that serves snapshots has anything to refresh; in a browser
  // the document came from the cloud to begin with.
  const { crdt } = useDocsPorts();
  useEffect(() => {
    if (!crdt || !docId) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = crdt.onRefresh(docId, (s) => {
      if (s === "start") {
        // Arm, don't announce: most refreshes land before this fires.
        clearTimeout(timer);
        timer = setTimeout(() => setState("checking"), QUIET_MS);
        return;
      }
      clearTimeout(timer);
      // `failed` is not transient — the copy on screen stays stale until
      // something else refreshes it, so the badge stays too.
      setState(s === "failed" ? "stale" : "fresh");
    });

    return () => {
      clearTimeout(timer);
      off();
    };
  }, [crdt, docId]);

  return state;
}

/** The badge itself. Renders nothing while the copy on screen is current. */
export function CachedCopyBadge({ state }: { state: CachedCopyState }) {
  if (state === "fresh") return null;
  const stale = state === "stale";
  return (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium " +
        (stale
          ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
          : "bg-muted text-muted-foreground")
      }
      title={
        stale
          ? "Couldn't reach the cloud. This is the last copy saved on this Mac — any newer edits made elsewhere aren't shown."
          : "Showing the copy saved on this Mac while the current one loads."
      }
    >
      <span
        className={
          "size-1.5 rounded-full " + (stale ? "bg-amber-500" : "animate-pulse bg-muted-foreground/60")
        }
        aria-hidden
      />
      {stale ? "Cached copy — offline" : "Showing a cached copy…"}
    </span>
  );
}
