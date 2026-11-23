// An owner's discovered repos and Claude sessions: what the worker reports, what
// the admin picker reads, and the rescan request that passes between them.
//
// Every function here runs on the SERVER, with the secret key. The worker used
// to call report_worker_repos / report_worker_sessions / take_repo_rescan
// itself over PostgREST, passing its own owner id to RPCs that trusted it
// (security lockdown stage 2 closed that). Now it POSTs the discovered set to
// /api/v1/worker/repos and /worker/sessions, and the API — which resolved the
// key to its owner — calls these with that owner. The scanner itself stays in
// @markbase/local/runner: it reads ~/.claude/projects and shells out to git, which
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

export interface WorkerSession {
  sessionId: string;
  title: string | null;
  lastActive: string | null;
}
