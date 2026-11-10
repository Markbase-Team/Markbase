import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { TICKET_PROMPT_PREFIX } from "@markbase/node/claude-code";
import { getRemoteOrigin, normalizeRemote } from "@markbase/node/repos";
import { WorkerApi } from "@markbase/protocol/worker-api";

const exec = promisify(execFile);

// Where Claude Code writes its per-project session logs: one directory per
// project (the cwd, with "/" encoded as "-"), each holding <session-id>.jsonl.
function claudeProjectsDir(override?: string): string {
  return override ?? path.join(os.homedir(), ".claude", "projects");
}

/**
 * Is `p` inside (or exactly) one of `roots`? Segment-aware: "/Work" is not a
 * parent of "/Workshop".
 */
function insideAny(p: string, roots: string[]): boolean {
  const norm = (x: string): string => {
    const abs = path.resolve(x);
    return abs.length > 1 && abs.endsWith(path.sep) ? abs.slice(0, -1) : abs;
  };
  const target = norm(p);
  return roots.some((r) => {
    const root = norm(r);
    return target === root || target.startsWith(root + path.sep);
  });
}

/**
 * What a discovery pass may look at.
 *
 * The scan used to probe every folder Claude Code had ever been run in — an
 * `existsSync` and a `git rev-parse` in each — on a timer, from the moment the
 * worker started. On a Mac that reaches into Desktop and Documents, and macOS
 * asks the person whether Markbase may read folders they never pointed it at.
 * The person chooses what folders to mount, and nothing else is theirs to be
 * asked about. So a pass names its folders, and a session recorded anywhere
 * else is left exactly where it is: not probed, not reported.
 */
export interface DiscoverOptions {
  /** Folders whose Claude Code sessions may be probed and reported. */
  within: string[];
  /** Where Claude Code keeps its session logs; tests point it elsewhere. */
  projectsDir?: string;
}

// This file SCANS. What it finds goes to the web API (POST /api/v1/worker/repos
// and /worker/sessions, see run-ticket-worker.ts), and the server writes the
// tables — the runner holds no database credential since security lockdown
// stage 2. The shapes and the server-side reads and writes live in
// @markbase/protocol/worker-repos; re-exported so existing importers of
// @markbase/runner keep resolving.
export type {
  DiscoveredRepo,
  DiscoveredSession,
  RepoStatus,
  WorkerRepo,
  WorkerSession,
} from "@markbase/protocol/worker-repos";
export {
  listWorkerRepos,
  listWorkerSessions,
  reportWorkerRepos,
  reportWorkerSessions,
  requestRepoRescan,
  takeRepoRescan,
} from "@markbase/protocol/worker-repos";
import type { DiscoveredRepo, DiscoveredSession, RepoStatus } from "@markbase/protocol/worker-repos";

// One folder's sessions all share the same cwd (the folder name IS that cwd,
// encoded), so we only need to find the cwd once per folder. The first JSONL
// line is often a summary record with no cwd, so read forward through the head
// of the file until a line carries one. Read a bounded prefix to keep the sweep
// cheap even when a session file is large.
async function readCwd(
  file: string
): Promise<{ cwd: string; branch: string | null } | null> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const text = buf.subarray(0, bytesRead).toString("utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj: { cwd?: string; gitBranch?: string } = JSON.parse(trimmed);
        if (obj.cwd) return { cwd: obj.cwd, branch: obj.gitBranch ?? null };
      } catch {
        // truncated/last partial line in the prefix — skip
      }
    }
  } finally {
    await fh.close();
  }
  return null;
}

// Resolve a folder's git toplevel; null when it isn't inside a git work tree.
async function gitToplevel(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await exec(
      "git",
      ["-C", cwd, "rev-parse", "--show-toplevel"],
      { timeout: 10_000 }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// Pull "owner/repo" out of a remote url. Handles https
// (github.com/owner/repo), SSH (git@host:owner/repo), and custom host aliases
// (git@github-me:owner/repo) alike. Null when no owner/repo segment is present.
function ownerRepo(url: string): string | null {
  const clean = url.trim().replace(/\.git$/, "");
  const m = clean.match(/[:/]([\w.-]+\/[\w.-]+)$/);
  return m ? m[1] : null;
}

// Cap sessions reported per repo so the sweep stays bounded.
const SESSIONS_PER_REPO = 20;

type MsgContent = string | Array<{ type?: string; text?: string }>;

// Pull readable text out of a session line's user message (content is either a
// string or an array of content blocks).
function userText(content: MsgContent | undefined): string | null {
  if (typeof content === "string") return content || null;
  if (Array.isArray(content)) {
    const block = content.find(
      (p) => p && p.type === "text" && typeof p.text === "string"
    );
    return block?.text ?? null;
  }
  return null;
}

// The first real user message of a session (whitespace-collapsed), from the same
// bounded prefix we read for the cwd. Skips meta/command stubs.
async function firstUserMessage(file: string): Promise<string | null> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const text = buf.subarray(0, bytesRead).toString("utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: { type?: string; message?: { content?: MsgContent } };
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (obj.type !== "user" || !obj.message) continue;
      const msg = userText(obj.message.content);
      if (!msg) continue;
      const clean = msg.replace(/\s+/g, " ").trim();
      if (
        !clean ||
        clean.startsWith("<") ||
        clean.startsWith("Caveat:") ||
        clean.startsWith("This session is being continued")
      ) {
        continue;
      }
      return clean;
    }
  } finally {
    await fh.close();
  }
  return null;
}

// Turn a first user message into a session title. The worker's own ticket-run
// sessions all open with the same boilerplate, so title those by their ticket
// ("Ticket: <title>", pulled from the prompt's "Title:" line) to keep them
// distinguishable; otherwise use the message itself.
function sessionTitle(firstMsg: string | null): string | null {
  if (!firstMsg) return null;
  if (firstMsg.startsWith(TICKET_PROMPT_PREFIX)) {
    const m = firstMsg.match(/Title:\s*(.+?)\s+Description:/);
    const ticketTitle = m?.[1]?.trim();
    return ticketTitle ? `Ticket: ${ticketTitle}` : "Ticket run";
  }
  return firstMsg.slice(0, 100);
}

interface RawHit {
  cwd: string;
  branch: string | null;
  lastActiveMs: number;
  sessionFiles: { sessionId: string; filePath: string; mtimeMs: number }[];
}

// One pass over ~/.claude/projects: a hit per project folder carrying its cwd,
// newest activity, and the session files within (a folder maps to one cwd).
async function scanFolders(opts: DiscoverOptions): Promise<RawHit[]> {
  const root = claudeProjectsDir(opts.projectsDir);
  if (!existsSync(root)) return [];
  // Nothing to look in: nothing is read, not even the session logs.
  if (opts.within.length === 0) return [];

  const hits: RawHit[] = [];
  const folders = await readdir(root, { withFileTypes: true });
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const folderPath = path.join(root, folder.name);
    let files: string[];
    try {
      files = (await readdir(folderPath)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    if (!files.length) continue;

    const stats = (
      await Promise.all(
        files.map(async (f) => {
          try {
            return { f, m: (await stat(path.join(folderPath, f))).mtimeMs };
          } catch {
            return null;
          }
        })
      )
    ).filter((s): s is { f: string; m: number } => s !== null);
    if (!stats.length) continue;
    stats.sort((a, b) => b.m - a.m); // newest first

    // Parse newest-first until we find a line carrying the cwd.
    let found: { cwd: string; branch: string | null } | null = null;
    for (const { f } of stats) {
      found = await readCwd(path.join(folderPath, f));
      if (found) break;
    }
    if (!found) continue;
    // A session run somewhere the person did not mount. Dropped before any
    // probe: the cwd is not checked for existence, no git runs in it, and it
    // is not reported.
    if (!insideAny(found.cwd, opts.within)) continue;

    hits.push({
      ...found,
      lastActiveMs: stats[0].m,
      sessionFiles: stats.map((s) => ({
        sessionId: s.f.replace(/\.jsonl$/, ""),
        filePath: path.join(folderPath, s.f),
        mtimeMs: s.m,
      })),
    });
  }
  return hits;
}

// Scan ~/.claude/projects once and return both the deduped, classified repos and
// the recent sessions per cwd — only for sessions inside `opts.within` (see
// DiscoverOptions). Non-git folders are first-class (status "not-a-repo").
// Paths that no longer exist on disk are dropped.
export async function discoverClaude(opts: DiscoverOptions): Promise<{
  repos: DiscoveredRepo[];
  sessions: DiscoveredSession[];
}> {
  const hits = await scanFolders(opts);

  // Repos: resolve each cwd to its git toplevel, classify, and merge hits that
  // collapse to the same repo (e.g. subdirs of one repo, or worktree dirs).
  const byRoot = new Map<string, DiscoveredRepo & { lastActiveMs: number }>();
  for (const hit of hits) {
    if (!existsSync(hit.cwd)) continue; // gone — don't report

    const top = await gitToplevel(hit.cwd);
    let canonical = hit.cwd;
    let status: RepoStatus = "not-a-repo";
    let remote: string | null = null;
    if (top) {
      canonical = top;
      const origin = await getRemoteOrigin(top);
      if (origin) {
        status = "ready";
        remote = ownerRepo(origin) ?? normalizeRemote(origin) ?? origin;
      } else {
        status = "no-remote";
      }
    }

    const prev = byRoot.get(canonical);
    if (!prev || hit.lastActiveMs > prev.lastActiveMs) {
      byRoot.set(canonical, {
        cwd: canonical,
        remote,
        branch: hit.branch ?? prev?.branch ?? null,
        status,
        lastActive: new Date(hit.lastActiveMs).toISOString(),
        lastActiveMs: hit.lastActiveMs,
      });
    } else if (!prev.branch && hit.branch) {
      prev.branch = hit.branch;
    }
  }

  const repos = [...byRoot.values()]
    .map(({ lastActiveMs: _drop, ...repo }) => repo)
    .sort((a, b) => (a.lastActive < b.lastActive ? 1 : -1));

  // Sessions: keyed by the folder's exact cwd (not the git toplevel) so a picked
  // session resumes in the directory it was created in. Take the most recent per
  // cwd, then read titles only for those.
  const sessions: DiscoveredSession[] = [];
  for (const hit of hits) {
    if (!existsSync(hit.cwd)) continue;
    const recent = hit.sessionFiles
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, SESSIONS_PER_REPO);
    for (const f of recent) {
      sessions.push({
        sessionId: f.sessionId,
        repoCwd: hit.cwd,
        title: sessionTitle(await firstUserMessage(f.filePath)),
        lastActive: new Date(f.mtimeMs).toISOString(),
      });
    }
  }

  return { repos, sessions };
}

// Repos-only convenience wrapper (callers that don't need sessions).
export async function discoverClaudeRepos(opts: DiscoverOptions): Promise<DiscoveredRepo[]> {
  return (await discoverClaude(opts)).repos;
}

/**
 * Claude Code was just run in `cwd` through Markbase: register that folder's
 * repo and its recent sessions with the API, now.
 *
 * This is WHEN a session check happens — the moment the person runs Claude
 * Code from the app, in a folder they chose — rather than on a background
 * timer over everything Claude Code was ever run in. Best-effort: the agent is
 * already running, and a failure to register it is a log line, not an error.
 */
export async function reportClaudeRun(opts: {
  appUrl: string;
  apiKey: string;
  cwd: string;
  log?: (message: string) => void;
  fetch?: typeof globalThis.fetch;
  projectsDir?: string;
}): Promise<void> {
  const log = opts.log ?? (() => {});
  try {
    const { repos, sessions } = await discoverClaude({ within: [opts.cwd], projectsDir: opts.projectsDir });
    const api = new WorkerApi(opts.appUrl, opts.apiKey, { fetch: opts.fetch });
    await api.reportRepos(repos);
    await api.reportSessions(sessions);
    log(`registered ${opts.cwd} (${repos.length} repo, ${sessions.length} session${sessions.length === 1 ? "" : "s"})`);
  } catch (e) {
    log(`couldn't register ${opts.cwd}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Whether a session log still exists anywhere under ~/.claude/projects. Used at
// dispatch to decide resume vs. fresh (sessions get pruned). Session ids are
// UUIDs, so a name match in any project folder is unambiguous.
export async function sessionExists(sessionId: string): Promise<boolean> {
  const root = claudeProjectsDir();
  if (!existsSync(root)) return false;
  let folders;
  try {
    folders = await readdir(root, { withFileTypes: true });
  } catch {
    return false;
  }
  return folders.some(
    (folder) =>
      folder.isDirectory() &&
      existsSync(path.join(root, folder.name, `${sessionId}.jsonl`))
  );
}

