"use client";

import { useSyncExternalStore } from "react";

// Which document is open, for the sidebar's highlight.
//
// The sidebar tree is memoised and takes no "active" prop on purpose: a real
// vault renders thousands of rows, and a prop would redraw all of them on every
// tab switch. Instead the shell writes the open id here, and each row asks only
// "is it me?". useSyncExternalStore re-renders a row only when that answer
// changes, so a switch redraws two rows: the one left and the one opened.

let activeId: string | null = null;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Called by the shell whenever the open document changes. */
export function setActiveDoc(id: string | null): void {
  if (id === activeId) return;
  activeId = id;
  for (const fn of listeners) fn();
}

/** True while `id` is the open document. */
export function useIsActiveDoc(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => activeId === id,
    () => false
  );
}
