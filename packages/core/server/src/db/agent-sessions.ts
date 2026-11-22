// The database half of @markbase/protocol/agent-sessions: every query here runs on the web
// server with the secret key. The shapes these return stay in protocol.

import { supabase } from "../supabase";
import {
  type Provider,
  type AgentSession,
  mintSessionToken,
  type StoredForReconcile,
  reconcileSessions,
  claimedStatus,
  type AgentSessionSummary,
  type AgentSpawnRequest,
  type AgentMessageRequest,
  type DiscoveredAgentSession,
} from "@markbase/protocol/agent-sessions";

/**
 * Most recent first — where "recent" is the later of last_active and created_at.
 *
 * Ordering on last_active alone does not work, for two reasons that compound.
 *
 * The worker's sweep stamps last_active on EVERY session it discovers, in one
 * pass: 65 sessions here all carry the same millisecond. So the sort key is a
 * total tie and the database is free to return any order it likes — which is why
 * the assignee picker, showing only the first few, seemed to show arbitrary ones.
 *
 * And a session that has never been swept has last_active NULL, so it sorted to
 * the very bottom — the newest session was the hardest one to find.
 *
 * created_at breaks the tie and stands in for a missing last_active, so a session
 * is ranked by the most recent thing known about it. Sorted here rather than in
 * the query because PostgREST cannot order on COALESCE, and the list is per-owner
 * and small.
 */
export async function listAgentSessions(
  ownerId: string
): Promise<AgentSessionSummary[]> {
  const { data, error } = await supabase
    .from("agent_sessions")
    .select(
      "id, owner_id, name, provider, connection_id, external_session_id, status, ended_reason, context, last_seen, last_active, created_at"
    )
    .eq("owner_id", ownerId);
  if (error) throw error;
  return ((data ?? []) as AgentSessionSummary[]).sort(
    (a, b) => recencyOf(b) - recencyOf(a) || at(b.created_at) - at(a.created_at)
  );
}

const at = (iso: string | null): number => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? 0 : t;
};

/**
 * When a session was last meaningfully touched: its activity, or failing that
 * when it was made.
 *
 * COALESCE, not max. Taking the later of the two looks equivalent and is not: the
 * sweep stamps last_active on every session at once, and that timestamp is newer
 * than any created_at, so max() returns the same value for all of them and the
 * tie the sort exists to break survives intact. A test caught this.
 */
function recencyOf(s: Pick<AgentSessionSummary, "last_active" | "created_at">): number {
  return s.last_active ? at(s.last_active) : at(s.created_at);
}

export async function getAgentSessionByToken(
  ownerId: string,
  token: string
): Promise<AgentSession | undefined> {
  const { data, error } = await supabase
    .from("agent_sessions")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("session_token", token)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as AgentSession | undefined;
}

// Register a new agent as a pending session slot: name + minted token are ours;
// the provider claims it later (external_session_id stays null until then).
export async function createAgentSession(input: {
  ownerId: string;
  name: string;
  provider: Provider;
  connectionId?: string | null;
}): Promise<AgentSession> {
  const { data, error } = await supabase
    .from("agent_sessions")
    .insert({
      owner_id: input.ownerId,
      name: input.name,
      provider: input.provider,
      connection_id: input.connectionId ?? null,
      session_token: mintSessionToken(),
      status: "pending",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as AgentSession;
}

export async function renameAgentSession(
  ownerId: string,
  id: string,
  name: string
): Promise<AgentSession | undefined> {
  const { data, error } = await supabase
    .from("agent_sessions")
    .update({ name })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as AgentSession | undefined;
}

// End a session on purpose (user_ended, distinct from deleted_upstream). Kept as
// history — the row isn't deleted.
export async function endAgentSession(
  ownerId: string,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_sessions")
    .update({ status: "ended", ended_reason: "user_ended" })
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw error;
}

// A provider claims a pending slot by presenting its session_token. Marks it
// active and stamps the connection/provider that claimed it. Idempotent for an
// already-live session (just bumps last_seen); returns null if the token is
// unknown for this owner or the session is dead (ended/missing).
export async function claimAgentSession(input: {
  ownerId: string;
  token: string;
  connectionId?: string | null;
  externalSessionId?: string | null;
}): Promise<AgentSession | null> {
  const existing = await getAgentSessionByToken(input.ownerId, input.token);
  if (!existing) return null;
  const next = claimedStatus(existing.status);
  if (!next) return null;

  const now = new Date().toISOString();
  const patch: Record<string, string | null> = { status: next, last_seen: now, last_active: now };
  if (input.connectionId && !existing.connection_id) patch.connection_id = input.connectionId;
  if (input.externalSessionId && !existing.external_session_id) {
    patch.external_session_id = input.externalSessionId;
  }
  const { data, error } = await supabase
    .from("agent_sessions")
    .update(patch)
    .eq("id", existing.id)
    .eq("owner_id", input.ownerId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AgentSession | null;
}

// Bind a session to the provider session id the worker just spawned (via
// --session-id), marking it active. Used by worker auto-spawn — the worker knows
// the id up front, so no claim round-trip is needed.
export async function setAgentSessionExternalId(input: {
  ownerId: string;
  agentSessionId: string;
  externalSessionId: string;
  /** Where the session runs. `claude -r` only finds it from this directory. */
  repoCwd?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, string | Record<string, string>> = {
    external_session_id: input.externalSessionId,
    status: "active",
    last_seen: now,
    last_active: now,
  };
  if (input.repoCwd) patch.context = { repo_cwd: input.repoCwd };
  const { error } = await supabase
    .from("agent_sessions")
    .update(patch)
    .eq("id", input.agentSessionId)
    .eq("owner_id", input.ownerId);
  if (error) throw error;
}

// Ask the local worker to launch a session for a pending agent slot.
export async function createAgentSpawnRequest(input: {
  ownerId: string;
  agentSessionId: string;
  project: string;
  prompt: string;
}): Promise<AgentSpawnRequest> {
  const { data, error } = await supabase
    .from("agent_spawn_requests")
    .insert({
      owner_id: input.ownerId,
      agent_session_id: input.agentSessionId,
      project: input.project,
      prompt: input.prompt,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as AgentSpawnRequest;
}

// The queued requests of both kinds for one owner, oldest first — what the
// worker polls (GET /api/v1/worker/agent-requests) before claiming one by id.
// Capped: the worker drains one per idle tick, so a long backlog is paged.
export async function listQueuedAgentRequests(
  ownerId: string,
  limit = 10
): Promise<{ spawn: AgentSpawnRequest[]; message: AgentMessageRequest[] }> {
  const [spawn, message] = await Promise.all([
    supabase
      .from("agent_spawn_requests")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(limit),
    supabase
      .from("agent_message_requests")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(limit),
  ]);
  if (spawn.error) throw spawn.error;
  if (message.error) throw message.error;
  return {
    spawn: (spawn.data ?? []) as AgentSpawnRequest[],
    message: (message.data ?? []) as AgentMessageRequest[],
  };
}

// Claim one spawn request for an owner (the worker, through the API). The
// status guard on the update makes the claim atomic; null when it is not this
// owner's, is gone, or another worker took it first.
export async function claimSpawnRequest(
  ownerId: string,
  id: string
): Promise<AgentSpawnRequest | null> {
  const { data: claimed, error } = await supabase
    .from("agent_spawn_requests")
    .update({ status: "running", claimed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (claimed ?? null) as AgentSpawnRequest | null;
}

// Owner-scoped: a worker can only finish its own owner's requests. Returns
// whether a row was finished, so the API can answer 404 for anyone else's.
export async function finishSpawnRequest(
  ownerId: string,
  id: string,
  status: "done" | "error",
  errorMessage?: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_spawn_requests")
    .update({
      status,
      error: errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function createAgentMessageRequest(input: {
  ownerId: string;
  agentSessionId: string;
  docId?: string | null;
  commentId?: string | null;
  prompt: string;
}): Promise<AgentMessageRequest> {
  const { data, error } = await supabase
    .from("agent_message_requests")
    .insert({
      owner_id: input.ownerId,
      agent_session_id: input.agentSessionId,
      doc_id: input.docId ?? null,
      comment_id: input.commentId ?? null,
      prompt: input.prompt,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as AgentMessageRequest;
}

// Claim one message request for an owner (the worker, through the API). The
// status guard makes the claim atomic; null when it is not this owner's, is
// gone, or another worker took it first.
export async function claimMessageRequest(
  ownerId: string,
  id: string
): Promise<AgentMessageRequest | null> {
  const { data: claimed, error } = await supabase
    .from("agent_message_requests")
    .update({ status: "running", claimed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (claimed ?? null) as AgentMessageRequest | null;
}

// Owner-scoped, like finishSpawnRequest. True when a row was finished.
export async function finishMessageRequest(
  ownerId: string,
  id: string,
  status: "done" | "error",
  errorMessage?: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_message_requests")
    .update({
      status,
      error: errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

// The full row, including session_token — worker-side only, never sent to a
// browser (that's what listAgentSessions / AgentSessionSummary is for).
export async function getAgentSessionById(
  ownerId: string,
  id: string
): Promise<AgentSession | undefined> {
  const { data, error } = await supabase
    .from("agent_sessions")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as AgentSession | undefined;
}

// Stamp a connection's provider once it's known (from mcp install or the MCP
// initialize handshake), but only when it hasn't been set yet, so a real signal
// never gets overwritten back to "unknown".
export async function setConnectionProvider(
  keyId: string,
  provider: Provider
): Promise<void> {
  if (provider === "unknown") return;
  const { error } = await supabase
    .from("api_keys")
    .update({ provider })
    .eq("id", keyId)
    .eq("provider", "unknown");
  if (error) throw error;
}

export async function reconcileAgentSessions(input: {
  ownerId: string;
  provider: Provider;
  connectionId: string | null;
  discovered: DiscoveredAgentSession[];
  scopeRepoCwd?: string | null;
}): Promise<{ activated: number; missing: number; created: number }> {
  const { ownerId, provider, connectionId, discovered, scopeRepoCwd } = input;

  let q = supabase
    .from("agent_sessions")
    .select("id, external_session_id, status, last_seen")
    .eq("owner_id", ownerId)
    .eq("provider", provider);
  if (scopeRepoCwd) q = q.eq("context->>repo_cwd", scopeRepoCwd);
  const { data: stored, error } = await q;
  if (error) throw error;

  const now = new Date().toISOString();
  const { activate, markMissing, newExternalIds } = reconcileSessions(
    (stored ?? []) as StoredForReconcile[],
    discovered.map((d) => d.external_session_id)
  );

  if (activate.length) {
    const { error: e } = await supabase
      .from("agent_sessions")
      .update({ status: "active", last_seen: now, last_active: now })
      .in("id", activate);
    if (e) throw e;
  }

  if (markMissing.length) {
    const { error: e } = await supabase
      .from("agent_sessions")
      .update({ status: "missing", ended_reason: "deleted_upstream" })
      .in("id", markMissing);
    if (e) throw e;
  }

  if (newExternalIds.length) {
    const byId = new Map(discovered.map((d) => [d.external_session_id, d]));
    const rows = newExternalIds.map((extId) => {
      const d = byId.get(extId)!;
      return {
        owner_id: ownerId,
        name: d.name,
        provider,
        connection_id: connectionId,
        session_token: mintSessionToken(),
        external_session_id: extId,
        status: "active" as const,
        context: d.context,
        last_seen: now,
        last_active: d.last_active ?? now,
      };
    });
    const { error: e } = await supabase.from("agent_sessions").insert(rows);
    if (e) throw e;
  }

  return {
    activated: activate.length,
    missing: markMissing.length,
    created: newExternalIds.length,
  };
}
