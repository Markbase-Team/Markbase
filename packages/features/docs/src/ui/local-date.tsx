"use client";

import { useSyncExternalStore } from "react";

// A date formatted in the USER's locale + timezone — without a hydration mismatch.
//
// toLocaleDateString/toLocaleString use the runtime's locale and timezone, and the
// server's (UTC, en-US) rarely match the browser's. Rendering that directly makes
// the server HTML and the first client render disagree, which React flags. So we
// render a stable, timezone-free value on the server and first paint (the ISO
// day/second), then localize once mounted — same text on both sides at hydration,
// no mismatch.
/** Nothing to listen to: these values are fixed once the browser has them. */
const subscribeNever = (): (() => void) => () => {};

export function LocalDate({
  value,
  mode = "date",
}: {
  value: string;
  /** "date" → 7/16/2026; "datetime" → 7/16/2026, 5:55 PM */
  mode?: "date" | "datetime";
}) {
  const iso = mode === "datetime" ? value.replace("T", " ").slice(0, 16) : value.slice(0, 10);
  // The server has no locale to format in, so it renders the ISO text and the
  // browser replaces it. useSyncExternalStore is how React says exactly that —
  // a server snapshot and a client one — instead of a state that an effect
  // corrects a beat after hydration. Nothing to subscribe to: it never changes
  // again once mounted.
  const text = useSyncExternalStore(
    subscribeNever,
    () => {
      const d = new Date(value);
      return mode === "datetime" ? d.toLocaleString() : d.toLocaleDateString();
    },
    () => iso
  );

  return <span suppressHydrationWarning>{text}</span>;
}
