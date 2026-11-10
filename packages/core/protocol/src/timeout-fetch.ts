// Every request to the cloud gets a deadline.
//
// fetch() has none. A server that accepts the connection and never answers — a
// hung API, a database that stopped responding, a dead network — leaves the
// request pending forever. For the sync loop that meant a pass that never
// finished, so it never learned the cloud was down and never backed off. With a
// deadline a hung request is a failed one, and failure the callers already handle.

/** How long an ordinary API request may take. */
export const REQUEST_TIMEOUT_MS = 20_000;
/** How long moving a file's bytes may take — media uploads and downloads. */
export const TRANSFER_TIMEOUT_MS = 120_000;

/**
 * MARKBASE_REQUEST_TIMEOUT_MS caps every deadline — so a test needn't wait 20 s
 * for a hang. Read through globalThis: this module is shipped to the browser
 * too (@markbase/ui imports the instance helpers), where there is no process
 * and the package is typechecked without Node's types.
 */
function capped(ms: number): number {
  const env: { MARKBASE_REQUEST_TIMEOUT_MS?: string } =
    (globalThis as { process?: { env?: { MARKBASE_REQUEST_TIMEOUT_MS?: string } } }).process
      ?.env ?? {};
  const cap = Number(env.MARKBASE_REQUEST_TIMEOUT_MS);
  return cap > 0 ? Math.min(ms, cap) : ms;
}

/** fetch(), but it gives up after `timeoutMs` (default REQUEST_TIMEOUT_MS). */
export function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...rest } = init;
  const deadline = AbortSignal.timeout(capped(timeoutMs));
  // Keep the caller's own signal working too (supabase-js passes one).
  const signal = rest.signal ? AbortSignal.any([rest.signal, deadline]) : deadline;
  return fetch(input, { ...rest, signal });
}
