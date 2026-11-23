import { callerFromHeaders } from "@markbase/shared/auth";
import type { EndpointCall } from "@markbase/shared/endpoint";
import type { NudgeKind } from "@markbase/shared/sync-nudges";
import { sendNudges } from "@markbase/server/nudges";
import { getDocument } from "./documents";
import { listMembers } from "./members";

// Which accounts' syncs to nudge after a write, and with what kind of change.
// Called for every endpoint call the server answers (the web app observes
// them all), so a write endpoint added tomorrow nudges with nothing to
// remember — the same way it becomes an MCP tool.
//
// Who: the account that made the change (its other machines keep the same
// vaults), and for a write to one document, everyone who has that document:
// its owner and its members. What: "content" for a change to a document's
// text, which the change feed reports; "structure" for the rest, which a
// sync's reconcile pass picks up.

/** Writes to a document's text. */
const CONTENT_WRITES: ReadonlySet<string> = new Set([
  "docs_writeCrdt",
  "docs_editDoc",
  "docs_replaceContent",
  "docs_restoreDoc",
]);

/**
 * Writes that change nothing a sync keeps: a comment, a share link, a
 * published copy, an agent's hook being reported. Nudging for these would
 * only make syncs ask for nothing.
 */
const NOT_KEPT: ReadonlySet<string> = new Set([
  "docs_addComment",
  "docs_resolveComment",
  "docs_createLink",
  "docs_deleteLink",
  "docs_publish",
  "docs_unpublish",
  "docs_reportHookEvents",
]);

/** The nudge a call calls for, or null when it changed nothing a sync keeps. */
export function nudgeKindFor(call: Pick<EndpointCall, "def" | "status">): NudgeKind | null {
  const { def, status } = call;
  if (def.scope !== "write" || status < 200 || status >= 300) return null;
  if (NOT_KEPT.has(def.id)) return null;
  return CONTENT_WRITES.has(def.id) ? "content" : "structure";
}

/** Everyone who has a document: its owner and its members. Empty when it is gone. */
async function docAccounts(docId: string): Promise<string[]> {
  const [doc, members] = await Promise.all([getDocument(docId), listMembers(docId)]);
  return [...(doc ? [doc.owner_id] : []), ...members.map((m) => m.user_id)];
}

/**
 * Nudge the syncs a call's write concerns. Never throws; a nudge that does not
 * go out waits for the safety poll.
 */
export async function nudgeAfterWrite(call: EndpointCall): Promise<void> {
  const kind = nudgeKindFor(call);
  if (!kind) return;
  const caller = callerFromHeaders(call.req.headers);
  if (!caller) return;
  try {
    const onDoc = call.def.path.startsWith("/docs/:id") ? call.params.id : undefined;
    const accounts = onDoc ? [caller.ownerId, ...(await docAccounts(onDoc))] : [caller.ownerId];
    await sendNudges(accounts, kind);
  } catch (err) {
    console.warn(`[nudges] ${call.def.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
