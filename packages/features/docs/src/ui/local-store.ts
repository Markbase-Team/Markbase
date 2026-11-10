// localStorage, without the boilerplate every caller was repeating.
//
// Three things make a plain `localStorage.getItem` unsafe here: it does not
// exist while rendering on the server, it throws outright in some private
// browsing modes, and `setItem` throws when the quota is full. None of those is
// worth breaking a page over — a tab strip that forgets its tabs is a smaller
// problem than a tab strip that does not render — so five different call sites
// had each grown the same `typeof window` check wrapped in the same try/catch.
//
// Parsing stays with the caller. What comes back out of storage is whatever was
// there last time, including something an older version of the app wrote, so the
// shape has to be checked rather than asserted; a helper that cast to the
// caller's type would quietly turn that risk into a lie. These return `Json` and
// let each site narrow it the way it already does.

/** Anything JSON.parse can return. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** The string stored at `key`, or null when it is absent or unreadable. */
export function readLocal(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Store `value` at `key`. A blocked or full store is not an error. */
export function writeLocal(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or quota — whatever this was persisting simply won't persist.
  }
}

/** Forget `key`. */
export function removeLocal(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // As above: losing the write is fine, throwing is not.
  }
}

/**
 * The JSON stored at `key`, or null when it is absent, unreadable, or not JSON.
 *
 * Deliberately not generic: the caller checks the shape. See the note above.
 */
export function readLocalJson(key: string): Json | null {
  const raw = readLocal(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as Json;
  } catch {
    return null;
  }
}

/** Store `value` at `key` as JSON. */
export function writeLocalJson(key: string, value: Json): void {
  writeLocal(key, JSON.stringify(value));
}

/**
 * The number stored at `key`, if it is one and it falls within `min`..`max`.
 *
 * Bounds are part of reading, not a separate step: a stored width from a build
 * with different limits, or a hand-edited entry, is exactly the case this is
 * here to survive.
 */
export function readLocalNumber(key: string, min: number, max: number): number | null {
  const raw = readLocal(key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}
