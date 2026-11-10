// How long a polling loop waits before its next try.
//
// A loop on a fixed interval keeps polling at full rate while the server is
// failing — exactly when it can least afford it. On 2026-09-13 the vault daemons
// and the job worker kept asking a database that had stopped answering, every
// 15 s and every 3 s, and it never got the room to recover. So: double the wait
// after each consecutive failure, up to a cap, and drop back to the base rate on
// the first success.

/** The longest a failing loop waits between tries. */
export const MAX_POLL_BACKOFF_MS = 5 * 60_000;

/**
 * The wait before the next try, given how many tries in a row have failed.
 *
 * Zero failures is the base interval exactly. Each failure doubles it, capped at
 * `maxMs`, with jitter so clients that failed together don't all come back in the
 * same instant. Never shorter than the base: backing off must not speed anything up.
 */
export function nextPollDelay(
  baseMs: number,
  failures: number,
  maxMs = MAX_POLL_BACKOFF_MS,
  random: () => number = Math.random
): number {
  if (failures <= 0) return baseMs;
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.min(failures, 30));
  // Jitter within [ceiling/2, ceiling] — spread out, but still backed off.
  return Math.max(baseMs, Math.round(ceiling / 2 + (random() * ceiling) / 2));
}
