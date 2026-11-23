import { SYNC_REQUEST_HEADER } from "@markbase/shared/analytics/user-analytics";

/**
 * The headers on every request a vault's sync makes: its key, and the mark
 * that says this is the sync and not an agent (SYNC_REQUEST_HEADER), so its
 * polling is not recorded as an agent's reads.
 */
export function syncHeaders(apiKey: string, extra: { [name: string]: string } = {}): { [name: string]: string } {
  return { Authorization: `Bearer ${apiKey}`, [SYNC_REQUEST_HEADER]: "1", ...extra };
}
