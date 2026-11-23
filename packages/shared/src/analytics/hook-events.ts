// Hook events — what an agent's hooks saw on someone's machine, reported to
// the server so it is in the user analytics record with everything else.
//
// An agent that reads or writes a vault file never calls the API: its hook
// (`markbase read-audit`, `markbase write-audit`) writes a line to a ledger on
// that machine, and nothing else knows. The sync daemon there sweeps the
// ledgers and posts the lines here, one event each, as the hook logged them.
// The server turns each into a user analytics row (action `hook.read` or
// `hook.write`), filling in whose account and which key from the request
// itself: a report says what happened, never who it happened for.
//
// One event is one thing that happened. Nothing here is a count: how often an
// agent read a document is worked out from the rows when it is asked.

export const HOOK_EVENTS_PATH = "/api/v1/hook-events";

/** What a hook can report. A new one is a kind here and an action below. */
export const HOOK_EVENT_KINDS = ["read", "write"] as const;
export type HookEventKind = (typeof HOOK_EVENT_KINDS)[number];

/** The user analytics action each kind is recorded as. */
export const HOOK_EVENT_ACTIONS: { [kind in HookEventKind]: "hook.read" | "hook.write" } = {
  read: "hook.read",
  write: "hook.write",
};

/** The role on a document a caller must hold to report each kind for it. */
export const HOOK_EVENT_NEEDS: { [kind in HookEventKind]: "viewer" | "editor" } = {
  read: "viewer",
  write: "editor",
};

/** The most events one report may carry; a daemon with more sends several. */
export const HOOK_EVENTS_MAX = 500;
/** The most documents one report may name, so checking access stays cheap. */
export const HOOK_EVENTS_MAX_DOCS = 50;

/** One thing an agent's hook saw. */
export interface HookEvent {
  kind: HookEventKind;
  /** The name the hook gave the agent: "claude", "codex", "cursor". */
  agent: string;
  docId: string;
  /** When it happened, in milliseconds. */
  at: number;
}

/** A report as it arrives: anything, until it is checked. */
export interface HookEventsBody {
  events?: { kind?: string | null; agent?: string | null; docId?: string | null; at?: number | null }[] | null;
}

/** The answer: for each event, in order, whether it was recorded. */
export interface HookEventsAnswer {
  recorded: boolean[];
}

/** The names agents' hooks record themselves under. */
const AGENT_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isHookEventKind(value: string | null | undefined): value is HookEventKind {
  return (HOOK_EVENT_KINDS as readonly string[]).includes(value ?? "");
}

/**
 * The events a report carries, or null when it is not a report: the whole of
 * it is refused, rather than some events quietly dropped, so a daemon that
 * sends a bad one finds out.
 */
export function parseHookEvents(body: HookEventsBody): HookEvent[] | null {
  const raw = body.events;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > HOOK_EVENTS_MAX) return null;
  const events: HookEvent[] = [];
  for (const e of raw) {
    const kind = e?.kind;
    const agent = e?.agent;
    const docId = e?.docId;
    const at = e?.at;
    if (!isHookEventKind(kind)) return null;
    if (typeof agent !== "string" || !AGENT_NAME.test(agent)) return null;
    if (typeof docId !== "string" || !UUID.test(docId)) return null;
    if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return null;
    events.push({ kind, agent, docId, at });
  }
  if (new Set(events.map((e) => e.docId)).size > HOOK_EVENTS_MAX_DOCS) return null;
  return events;
}
