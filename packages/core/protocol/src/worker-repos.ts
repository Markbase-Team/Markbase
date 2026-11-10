import { supabase } from "./supabase";
import { reconcileAgentSessions } from "./agent-sessions";

// An owner's discovered repos and Claude sessions: what the worker reports, what
// the admin picker reads, and the rescan request that passes between them.
//
// Every function here runs on the SERVER, with the secret key. The worker used
// to call report_worker_repos / report_worker_sessions / take_repo_rescan
// itself over PostgREST, passing its own owner id to RPCs that trusted it
// (security lockdown stage 2 closed that). Now it POSTs the discovered set to
// /api/v1/worker/repos and /worker/sessions, and the API — which resolved the
// key to its owner — calls these with that owner. The scanner itself stays in
// @markbase/runner: it reads ~/.claude/projects and shells out to git, which
// nothing here should know how to do.

/** Whether a discovered folder is a usable git repo. */
export type RepoStatus = "ready" | "no-remote" | "not-a-repo";

/** A repo the owner's worker reported, as the admin picker shows it. */
export interface WorkerRepo {
  cwd: string;
  remote: string | null;
  branch: string | null;
  status: RepoStatus;
  lastActive: string | null;
}

/** A repo as the worker's scan found it — the wire shape of POST /worker/repos. */
export interface DiscoveredRepo {
  /** Git toplevel of the repo, or the raw folder when it isn't a git repo. */
  cwd: string;
  /** "owner/repo" (or the origin url) when status is "ready", else null. */
  remote: string | null;
  /** Last-active branch seen in the session, if any. */
  branch: string | null;
  status: RepoStatus;
  /** Newest session mtime for this path (ISO). */
  lastActive: string;
}

/**
 * A Claude session a ticket can resume — the wire shape of POST /worker/sessions.
 * repoCwd is the session's exact cwd (so resuming `claude -r` in that directory
 * finds it), which is matched against a project's local_path in the ticket picker.
 */
export interface DiscoveredSession {
  sessionId: string;
  repoCwd: string;
  title: string | null;
  lastActive: string;
}

const REPO_STATUSES: readonly RepoStatus[] = ["ready", "no-remote", "not-a-repo"];

export function isRepoStatus(v: string | null | undefined): v is RepoStatus {
  return typeof v === "string" && (REPO_STATUSES as readonly string[]).includes(v);
}

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

export interface WorkerSession {
  sessionId: string;
  title: string | null;
  lastActive: string | null;
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
