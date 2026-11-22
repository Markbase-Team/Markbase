"use client";

import { useSyncExternalStore } from "react";

// "44 minutes ago", "yesterday", or the date once it is more than a week old.
//
// The pure formatter is separate from the component so it can be tested with a
// fixed clock. The component keeps every row on screen current from ONE timer:
// a sidebar renders hundreds of these, and one interval per row is hundreds of
// wake-ups a minute for text that changes once.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

let formatter: Intl.RelativeTimeFormat | null = null;
function rtf(): Intl.RelativeTimeFormat {
  // `numeric: "auto"` is what turns "1 day ago" into "yesterday".
  return (formatter ??= new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }));
}

/**
 * `iso` relative to `now`, in the runtime's locale. A moment in the future
 * (a clock ahead of the server's) reads as "just now" rather than "in 3 minutes".
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const ago = Math.max(0, now - then);
  if (ago < MINUTE) return "just now";
  if (ago < HOUR) return rtf().format(-Math.floor(ago / MINUTE), "minute");
  if (ago < DAY) return rtf().format(-Math.floor(ago / HOUR), "hour");
  if (ago < WEEK) return rtf().format(-Math.floor(ago / DAY), "day");
  return new Date(then).toLocaleDateString();
}

// One clock for every row. A subscriber is told once a minute — the smallest
// step the text can take — and the timer stops when the last row leaves.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  timer ??= setInterval(() => listeners.forEach((l) => l()), MINUTE);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function RelativeTime({ value }: { value: string }) {
  // The server has no clock to agree with the browser's, so it renders the ISO
  // day and the browser replaces it on hydration — the same arrangement as
  // LocalDate, for the same reason: text that differs between the two is a
  // hydration mismatch.
  const text = useSyncExternalStore(
    subscribe,
    () => relativeTime(value),
    () => value.slice(0, 10)
  );
  if (!text) return null;
  return (
    <time dateTime={value} title={new Date(value).toLocaleString()} suppressHydrationWarning>
      {text}
    </time>
  );
}
