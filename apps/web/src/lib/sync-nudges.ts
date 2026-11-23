import { observeEndpointCalls } from "@markbase/shared/endpoint";
import { nudgeAfterWrite } from "@markbase/docs/server";
import { afterResponse } from "./after-response";

// Sync nudges — where this server plugs them in. Every endpoint call is
// observed; one that wrote something a vault sync keeps nudges the syncs of
// everyone it concerns, after the response has gone. See
// @markbase/shared/sync-nudges for why, and @markbase/docs/server
// (nudgeAfterWrite) for who and what kind.

/** Observe every defined endpoint. Called once, when the server starts. */
export function startSyncNudges(): void {
  observeEndpointCalls((call) => afterResponse(() => nudgeAfterWrite(call)));
}
