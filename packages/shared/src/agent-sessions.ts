// An agent session is Markbase's own record tying a friendly name to a provider's
// resumable session id. name + session_token are ours; external_session_id is the
// provider's. Reconcile marks a session `missing` when the provider deletes it
// upstream (its local memory is gone) — we never rebind a name onto an empty
// session, so a missing session shows as ended, not resumable.

// Providers are text + CHECK in the DB (NOT a pg enum) so the set is easy to
// widen; keep this list in sync with the migration's CHECK constraints.
export const PROVIDERS = [
  "claude_code",
  "claude_desktop",
  "codex",
  "cursor",
  "unknown",
] as const;
export type Provider = (typeof PROVIDERS)[number];

export function isProvider(v: string | null | undefined): v is Provider {
  return typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);
}

// Map an MCP `clientInfo.name` (or an install target) to a provider. Unknown
// clients fall back to "unknown" rather than guessing.
export function providerFromClient(name: string | null | undefined): Provider {
  const n = (name ?? "").toLowerCase();
  if (n.includes("claude-code") || n.includes("claude code") || n === "claude_code") return "claude_code";
  if (n.includes("claude")) return "claude_desktop";
  if (n.includes("codex")) return "codex";
  if (n.includes("cursor")) return "cursor";
  return "unknown";
}

export type SessionStatus = "pending" | "active" | "idle" | "ended" | "missing";

export interface AgentSession {
  id: string;
  owner_id: string;
  name: string;
  provider: Provider;
  connection_id: string | null;
  session_token: string;
  external_session_id: string | null;
  status: SessionStatus;
  ended_reason: "user_ended" | "deleted_upstream" | null;
  context: Record<string, string>;
  last_seen: string | null;
  last_active: string | null;
  created_at: string;
}

// Our opaque, unguessable session handle. Distinct from the provider's id so the
// two can't be confused and a session can be re-pointed without changing handle.
export function mintSessionToken(): string {
  // Web Crypto, not node:crypto — this module is imported by the browser bundle
  // through @markbase/shared, and a node builtin here would put the whole
  // package back behind the node boundary for the sake of one UUID.
  return `sess_${crypto.randomUUID().replace(/-/g, "")}`;
}

// ---- Pure reconcile diff -----------------------------------------------------
// Given the sessions we have stored (for one owner+provider+context) and the set
// of provider session ids that still exist upstream, decide what to change:
//  - activate:  stored rows still present -> bump last_seen, keep active
//  - markMissing: active/idle rows whose id vanished upstream -> mark missing
//  - newExternalIds: live ids we've never recorded -> insert as new sessions
// `missing`/`ended` rows are left untouched: reconcile never resurrects a session
// (that requires a real resume), and never re-kills one already gone.
export interface StoredForReconcile {
  id: string;
  external_session_id: string | null;
  status: SessionStatus;
  last_seen: string | null;
}

// A just-spawned session is bound to its provider id before the provider has
// written its session file, so a sweep can race ahead and see it as "vanished".
// Never mark a session missing within this window of its last sighting.
export const RECONCILE_GRACE_MS = 5 * 60_000;

export function reconcileSessions(
  stored: StoredForReconcile[],
  liveExternalIds: string[],
  opts: { nowMs?: number; graceMs?: number } = {}
): { activate: string[]; markMissing: string[]; newExternalIds: string[] } {
  const nowMs = opts.nowMs ?? Date.now();
  const graceMs = opts.graceMs ?? RECONCILE_GRACE_MS;
  const live = new Set(liveExternalIds.filter(Boolean));
  const known = new Set(
    stored.map((s) => s.external_session_id).filter((x): x is string => !!x)
  );

  const activate: string[] = [];
  const markMissing: string[] = [];
  for (const s of stored) {
    if (s.status !== "active" && s.status !== "idle") continue; // don't touch pending/ended/missing
    if (!s.external_session_id) continue;
    if (live.has(s.external_session_id)) {
      activate.push(s.id);
      continue;
    }
    // Freshly seen/bound (e.g. auto-spawn) — give the provider time to write it.
    const seenMs = s.last_seen ? Date.parse(s.last_seen) : NaN;
    if (!Number.isNaN(seenMs) && nowMs - seenMs < graceMs) continue;
    markMissing.push(s.id);
  }

  const newExternalIds = [...live].filter((id) => !known.has(id));
  return { activate, markMissing, newExternalIds };
}

// ---- Claim transition (pure) -------------------------------------------------
// The status a session takes when a provider claims it (presents its token).
// A live/pending session becomes active; a dead one (ended/missing) can't be
// claimed — its local memory is gone, so we never resurrect it.
export function claimedStatus(current: SessionStatus): SessionStatus | null {
  if (current === "ended" || current === "missing") return null;
  return "active";
}

// ---- Data access -------------------------------------------------------------

// Never includes session_token: it's a credential the agent presents, and this
// list is rendered in the browser (Agents page, ticket assignee picker). The
// token is returned exactly once, by createAgentSession.
export type AgentSessionSummary = Omit<AgentSession, "session_token">;

// ---- Worker auto-spawn queue -------------------------------------------------

export interface AgentSpawnRequest {
  id: string;
  owner_id: string;
  agent_session_id: string;
  project: string;
  prompt: string;
  status: "queued" | "running" | "done" | "error";
  error: string | null;
  created_at: string;
  claimed_at: string | null;
  finished_at: string | null;
}

// ---- @mention message queue --------------------------------------------------
// A comment that @mentions an agent session queues a message here; the worker
// resumes that Claude session so the agent can reply.

export interface AgentMessageRequest {
  id: string;
  owner_id: string;
  agent_session_id: string;
  doc_id: string | null;
  comment_id: string | null;
  prompt: string;
  status: "queued" | "running" | "done" | "error";
  error: string | null;
  created_at: string;
  claimed_at: string | null;
  finished_at: string | null;
}

// Apply one reconcile pass: bump seen sessions, mark vanished ones missing, and
// insert newly-discovered ones. Each discovered session carries its own context
// (e.g. repo_cwd) used on insert. `scopeRepoCwd` limits the sweep to one repo
// when the report is per-repo; omit it for a full snapshot (e.g. the worker's
// report, which replaces all of an owner's sessions).
export interface DiscoveredAgentSession {
  external_session_id: string;
  name: string;
  last_active: string | null;
  context: Record<string, string>;
}
