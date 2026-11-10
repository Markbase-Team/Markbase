// An app-lifetime cache for GET requests, keyed by URL.
//
// The desktop app talks to a backend where a single round trip costs a few
// hundred milliseconds however small it is, so the thing worth minimising is the
// NUMBER of requests, not their size. Data that doesn't change while you use the
// app — the document list, a vault's assets, a doc's publish state — should be
// fetched once and then read from memory, however many times a component that
// needs it mounts and unmounts.
//
// Three rules:
//   • `cachedGet` is the default read. A URL fetched once is served from memory
//     forever after — no spinner, no request.
//   • Concurrent callers for one URL share a single in-flight request.
//   • Staleness is explicit: `refreshGet` when something may have changed
//     server-side, `invalidateCache` when WE changed it.
//
// The maps live at module scope, so they outlive every component and route and
// are only emptied when the page is (i.e. on app restart).
//
// Reads go through the shared api client, not fetch: the desktop app renders
// these same components from a local page, where a bare "/api/…" has no origin
// to resolve against and no cookie to carry. The client knows the base URL and
// the credential; this file never does.

import { api } from "@markbase/protocol/api-client";

type Cached = { value: unknown; at: number };

const cache = new Map<string, Cached>();
const inFlight = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();

/** Subscribe to cache writes — a refresh landing, or another reader's fetch. */
export function subscribeAppCache(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

/** The cached body for `url`, or undefined if it's never been fetched. */
export function peekGet<T>(url: string): T | undefined {
  return cache.get(url)?.value as T | undefined;
}

function request<T>(url: string): Promise<T> {
  const pending = inFlight.get(url) as Promise<T> | undefined;
  if (pending) return pending;
  // `no-store`: we are the cache. Letting the browser's HTTP cache also hold
  // these responses would put a second, invisible copy behind our invalidation.
  const req = api.request(url, { cache: "no-store" })
    .then(async (r) => {
      // A failure is not a value. This cache is app-lifetime, so storing the body
      // of a 401 or a 500 poisons the URL until the page is reloaded: the document
      // list read `{ error: … }`, found no `docs`, and settled into "Nothing in
      // this vault yet" — which then survived navigating away and back, because
      // every later read was served that same cached error.
      //
      // Throwing instead leaves the URL uncached, so the next reader tries again.
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
      return (await r.json()) as T;
    })
    .then((value) => {
      cache.set(url, { value, at: Date.now() });
      emit();
      return value;
    })
    .finally(() => {
      inFlight.delete(url);
    });
  inFlight.set(url, req);
  return req;
}

/** Read `url`: from memory if we have it, from the server if we don't. */
export function cachedGet<T>(url: string): Promise<T> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit.value as T);
  return request<T>(url);
}

/**
 * Go back to the server for `url` and update the cache — for when the data may
 * have changed underneath us (coming back to the window, a file synced up from
 * disk).
 *
 * `maxAgeMs` makes it a no-op while the cached copy is younger than that, so a
 * burst of events — which is what clicking the desktop title-bar drag region
 * produces — doesn't become a burst of requests.
 */
export function refreshGet<T>(url: string, maxAgeMs = 0): Promise<T> {
  const hit = cache.get(url);
  if (hit && maxAgeMs > 0 && Date.now() - hit.at < maxAgeMs) {
    return Promise.resolve(hit.value as T);
  }
  return request<T>(url);
}

/**
 * Drop cached entries after WE changed the underlying data. With no argument it
 * empties the cache; with a `prefix` it drops just the URLs that start with it
 * (e.g. "/api/v1/docs?" for every document-list scope, leaving per-doc entries
 * such as ".../publish" alone).
 */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
  } else {
    for (const key of [...cache.keys()]) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
  }
  emit();
}

/** Drop exactly one cached URL. */
export function invalidateUrl(url: string): void {
  if (cache.delete(url)) emit();
}

/**
 * Put a value we already hold into the cache, with no request — for state the UI
 * has already updated locally (an edited ticket, say), so that coming back to a
 * screen shows what you left rather than the last thing the server sent.
 *
 * The fetched-at stamp is preserved (0 for a new entry), so priming can never
 * make a stale entry look fresh and suppress a refresh. It deliberately doesn't
 * notify subscribers: whoever primed it already has the value on screen.
 */
export function primeCache(url: string, value: unknown): void {
  cache.set(url, { value, at: cache.get(url)?.at ?? 0 });
}
