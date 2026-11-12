import { getUserDisplay } from "./index";
import { personName } from "@markbase/protocol/attribution";

// The owner's display name, cached.
//
// Every edit that records a version needs it — "Jessie", or "Jessie's Claude
// Code" — and the only place a human display name exists is Supabase auth
// metadata, reachable through the admin API. That is a round trip, and /edits is
// an agent-facing hot path: paying for it per request would make attribution the
// slowest thing about editing a document.
//
// A name changes about never, so a short TTL is plenty. The cache is per server
// instance and deliberately dumb — a stale name for a few minutes is a far
// smaller problem than an auth call on every keystroke's worth of API edit.

const TTL_MS = 5 * 60_000;

const cache = new Map<string, { name: string; at: number }>();

/** The person changed their name: the next lookup asks again. */
export function forgetOwnerName(userId: string): void {
  cache.delete(userId);
}

/**
 * Resolve `userId` to a display name. `fallbackEmail` is used when the admin
 * lookup gives nothing — the caller often already holds the session's email, and
 * an email local part beats "Someone".
 */
export async function ownerDisplayName(
  userId: string,
  fallbackEmail: string | null = null
): Promise<string> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && now - hit.at < TTL_MS) return hit.name;

  // getUserDisplay swallows its own failures and returns nulls, so this resolves
  // to the fallback rather than throwing attribution into the request path.
  const display = await getUserDisplay(userId);
  const name = personName({
    name: display.name,
    email: display.email ?? fallbackEmail,
  });
  cache.set(userId, { name, at: now });
  return name;
}
