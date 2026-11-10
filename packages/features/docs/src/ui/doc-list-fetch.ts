// The document LIST, read through the app-lifetime cache.
//
// Two things need the same list: the tree in the sidebar and the shell (for tab
// titles and the wiki-link lookup). They share one cache entry per scope URL, so
// the list is fetched once per app run — reopening the surface, switching tabs,
// or any remount reads it from memory.
//
// This is a thin, doc-specific face over lib/app-cache so the invalidation rule
// ("every list scope, and only list scopes") lives in one place.

import {
  cachedGet,
  invalidateCache,
  invalidateUrl,
  peekGet,
  refreshGet,
} from "@markbase/ui/app-cache";

/** The unscoped list; the scoped ones add `?vault=…` / `?scope=shared`. */
const LIST_URL = "/api/v1/docs";

export { subscribeAppCache as subscribeDocLists } from "@markbase/ui/app-cache";

/** The cached list for `url`, or undefined if it's never been fetched. */
export function peekDocList<T>(url: string): T | undefined {
  return peekGet<T>(url);
}

/** The list for `url` — cached if we have it, fetched if we don't. */
export function fetchDocList<T>(url: string): Promise<T> {
  return cachedGet<T>(url);
}

/** Re-ask the server for `url`, at most once per `maxAgeMs`. */
export function refreshDocList<T>(url: string, maxAgeMs = 0): Promise<T> {
  return refreshGet<T>(url, maxAgeMs);
}

/**
 * Drop every cached list — after creating, deleting, renaming, or moving a
 * document, when the lists we hold no longer describe the vault.
 *
 * Deliberately narrow: `/api/v1/docs` also prefixes `/api/v1/docs/<id>/publish`,
 * which none of those actions change, so we drop the bare path and the query
 * forms rather than everything under the prefix.
 */
export function invalidateDocLists(): void {
  invalidateUrl(LIST_URL);
  invalidateCache(`${LIST_URL}?`);
}
