// The database half of @markbase/protocol/worker-repos: every query here runs on the web
// server with the secret key. The shapes these return stay in protocol.

import { supabase } from "../supabase";
import { reconcileAgentSessions } from "./agent-sessions";
import type {
  RepoStatus,
  WorkerRepo,
  DiscoveredRepo,
  DiscoveredSession,
  WorkerSession,
} from "@markbase/protocol/worker-repos";

/** Read an owner's discovered repos (newest-active first) for the admin picker. */
export async function listWorkerRepos(ownerId: string): Promise<WorkerRepo[]> {
  const { data, error } = await supabase
    .from("worker_repos")
    .select("cwd, remote, branch, status, last_active")
    .eq("owner_id", ownerId)
    .order("last_active", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    cwd: r.cwd,
    remote: r.remote,
    branch: r.branch,
    status: r.status as RepoStatus,
    lastActive: r.last_active,
  }));
}

// Read an owner's reported sessions for one repo (by its cwd / local_path),
// newest first, for the ticket "continue a session" picker.
export async function listWorkerSessions(
  ownerId: string,
  repoCwd: string
): Promise<WorkerSession[]> {
  const { data, error } = await supabase
    .from("worker_sessions")
    .select("session_id, title, last_active")
    .eq("owner_id", ownerId)
    .eq("repo_cwd", repoCwd)
    .order("last_active", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    sessionId: r.session_id,
    title: r.title,
    lastActive: r.last_active,
  }));
}

/**
 * Ask this owner's worker to re-scan now — sets a flag the worker takes on its
 * next idle poll. Used by the admin "Rescan paths" button.
 */
export async function requestRepoRescan(ownerId: string): Promise<void> {
  const { error } = await supabase.rpc("request_repo_rescan", {
    p_owner_id: ownerId,
  });
  if (error) throw error;
}

/**
 * Atomically take a pending rescan request for this owner: true at most once
 * per request, false when none is pending. The API calls it on the worker's
 * idle claim and reports the answer in the claim response.
 */
export async function takeRepoRescan(ownerId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("take_repo_rescan", {
    p_owner_id: ownerId,
  });
  if (error) throw error;
  return data === true;
}

/** Replace this owner's discovered repos with the set the worker just reported. */
export async function reportWorkerRepos(
  ownerId: string,
  repos: DiscoveredRepo[]
): Promise<void> {
  const { error } = await supabase.rpc("report_worker_repos", {
    p_owner_id: ownerId,
    p_repos: repos.map((r) => ({
      cwd: r.cwd,
      remote: r.remote,
      branch: r.branch,
      status: r.status,
      last_active: r.lastActive,
    })),
  });
  if (error) throw error;
}

/**
 * Replace this owner's discovered sessions with the set the worker just
 * reported. A full snapshot, so it also reconciles the canonical agent_sessions
 * table: newly-seen sessions become named agents, and any Claude Code session
 * that dropped out of the snapshot is marked missing (its local memory was
 * deleted).
 *
 * `connectionId` is the api_keys row the worker authenticated with — the
 * server knows it from the key, so the worker never has to say which machine
 * it is. Null only when a session (not a key) made the report, which no runner
 * does; the sessions are still recorded, just unattributed.
 */
export async function reportWorkerSessions(
  ownerId: string,
  sessions: DiscoveredSession[],
  connectionId: string | null
): Promise<void> {
  const { error } = await supabase.rpc("report_worker_sessions", {
    p_owner_id: ownerId,
    p_sessions: sessions.map((s) => ({
      session_id: s.sessionId,
      repo_cwd: s.repoCwd,
      title: s.title,
      last_active: s.lastActive,
    })),
  });
  if (error) throw error;

  // Best-effort: keep agent_sessions in sync. Never fail the report over it.
  // Global sweep (no scopeRepoCwd) because this snapshot spans every repo.
  try {
    await reconcileAgentSessions({
      ownerId,
      provider: "claude_code",
      connectionId,
      discovered: sessions.map((s) => ({
        external_session_id: s.sessionId,
        name: s.title?.trim() || `Session ${s.sessionId.slice(0, 8)}`,
        last_active: s.lastActive,
        context: { repo_cwd: s.repoCwd },
      })),
    });
  } catch {
    // reconcile is advisory; the authoritative worker_sessions write already succeeded
  }
}
