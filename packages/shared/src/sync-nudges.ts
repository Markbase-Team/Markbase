// Sync nudges — how a machine keeping vaults in step hears that something
// changed, instead of asking every few seconds.
//
// The server holds no sockets (it is serverless); Supabase Realtime does. After
// a write the server sends an account's topic one tiny message, "changed",
// with what kind of change it was and nothing else. A sync listening on that
// topic then asks the API what moved, exactly as it did when it polled: the
// cursor stays the truth, and the nudge only removes the waiting. A nudge that
// never arrives costs a delay, never data — the slow safety poll catches it.
//
// The topic is a public channel with an unguessable name the API hands the
// account's own machines (GET /api/v1/nudge). A public channel needs no login
// token, which a sync holding only an API key does not have. What the name
// protects is small: a nudge carries no document, no title, no content, so
// someone who learned it would know only that the account changed something,
// and when.
//
// Two seams keep the transport replaceable: the server sends through one
// helper (`sendNudges`), and a sync listens through one class (SyncNudges).

export const NUDGE_PATH = "/api/v1/nudge";

/** The broadcast event a nudge is sent as. */
export const NUDGE_EVENT = "changed";

/**
 * What changed. "content": a document's text, which the change feed reports.
 * "structure": anything else a sync keeps — a document made, renamed, moved
 * or deleted, a vault, a membership, an attachment — which a reconcile pass
 * picks up.
 */
export const NUDGE_KINDS = ["content", "structure"] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

export function isNudgeKind(value: string | null | undefined): value is NudgeKind {
  return (NUDGE_KINDS as readonly string[]).includes(value ?? "");
}

/** What a nudge carries. Nothing about what changed beyond its kind. */
export interface NudgePayload {
  kind: NudgeKind;
}

/** Where an account's machines listen: GET /api/v1/nudge. */
export interface NudgeChannel {
  /** The account's topic. Unguessable; anyone who has it hears that the account changed something. */
  topic: string;
  /** The Supabase project to connect to, and its publishable key. Both are public. */
  url: string;
  key: string;
}
