import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { Job } from "@markbase/protocol/jobs";
import { nextPollDelay } from "@markbase/protocol/poll-backoff";
import { detectClaudeVersion } from "@markbase/node/detect-claude";
import { syncMirror } from "@markbase/vault/mirror";
import {
  acquireWorkerLock,
  VaultLockedError,
  type VaultLock,
  type VaultLockInfo,
} from "@markbase/vault/vault-lock";
import type { TicketCcPatch } from "@markbase/protocol/tickets";
import { buildChatPrompt, buildPrompt, startClaudeCodeSession } from "@markbase/node/claude-code";
import { discoverClaude, sessionExists } from "./discover-repos";
// Same /api/v1/me the owner lookup used, but it keeps the connection too — see
// resolveIdentity.
import { resolveWorkerConnection } from "@markbase/protocol/worker-connection";
import { getRepoState } from "@markbase/node/repo-state";
import {
  WorkerApi,
  WorkerApiError,
  type ClaimedMessageRequest,
  type ClaimedSpawnRequest,
} from "@markbase/protocol/worker-api";
import { resolvePreviewUrl } from "@markbase/node/vercel-preview";
import { fetchLatestCliVersion, isVersionBehind } from "@markbase/protocol/version";
import type { McpConfig } from "@markbase/protocol/types";

// Caught values worth logging: real Errors, plain `{message, code, …}` objects
// (these stringify to "[object Object]"), or a bare string.
type ErrLike = Error | { message?: string } | string | null | undefined;

// Format a caught value into a readable log message.
function errMsg(e: ErrLike): string {
  if (e == null) return "unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e.message === "string" && e.message) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

// The ticket-execution worker engine, used by the `markbase` CLI (apps/markbase)
// and the desktop app (apps/app). It claims one owner's queued jobs and runs
// Claude Code against the project's local repo.
//
// Everything it knows about jobs, tickets, projects and agent requests it
// learns from the web API with its API key (security lockdown stage 2). The
// key names the owner, server-side; the worker never holds a database
// credential and never sends an owner id. A refused key (401/403) stops the
// worker and is reported to the host; a server or network failure is retried
// with backoff, as it always was.

/** What the worker is doing right now — for a host with somewhere to show it. */
export type WorkerState =
  | { kind: "waiting"; holder: VaultLockInfo }
  | { kind: "idle" }
  | { kind: "job"; ticketId: string };

export interface RunTicketWorkerOptions {
  /** Base URL of the web app (e.g. https://markbase.so). */
  appUrl: string;
  /** The owner's API key (jsk_…) — identifies whose jobs to run. */
  apiKey: string;
  /** Progress/log sink. Defaults to console.log. */
  log?: (message: string) => void;
  /** Poll interval when the queue is empty (ms). */
  pollMs?: number;
  /** Worker version (from package.json) — recorded for presence/upgrade nudges. */
  version?: string;
  /** Folder to mirror documents into as .md files. Empty/absent = mirroring off. */
  mirrorDir?: string;
  /**
   * The Claude to run tickets with: a path, or a name for PATH to resolve.
   * Absent means `claude` on PATH — the CLI's case. The desktop app passes the
   * binary it ships, because a GUI app has no user PATH and its users may never
   * have installed Claude Code.
   */
  claudeBin?: string;
  /**
   * How the host stops the worker. Abort it and the loop returns: the idle
   * sleep ends, no further job is claimed, and a job in flight has its Claude
   * session killed and is left for `reclaim_stale` to hand to the next worker —
   * the same thing that happens if the process dies, and the right thing for a
   * Log out or a quit. Without a signal the worker runs until the process does.
   */
  /**
   * Folders a repo scan ("Rescan paths") may look in: the vaults mounted on
   * this machine for the signed-in account. A Claude Code session recorded
   * anywhere else is not probed or reported. Omitted, a rescan looks nowhere.
   */
  discoverWithin?: () => string[];
  signal?: AbortSignal;
  /**
   * Take this machine's worker lock before claiming anything, as this name
   * ("cli", "desktop app"). While another process holds it, wait and say so
   * once, then take over when it lets go — the same arrangement the vaults
   * have. Absent means run regardless, which is only right for a machine that
   * cannot have two hosts (a server).
   */
  lockOwner?: string;
  /**
   * Whether to compare `version` against the published CLI and nudge the
   * operator to `markbase update`. Default on. The desktop app turns it off: it
   * is not installed from npm, and the nudge would be telling someone to
   * upgrade a package they do not have.
   */
  checkForUpdates?: boolean;
  /** Where the host hears what the worker is doing (the tray menu reads it). */
  onState?: (state: WorkerState) => void;
  /** Injected for tests; production uses the global fetch. */
  fetch?: typeof globalThis.fetch;
}

interface Ctx {
  appUrl: string;
  apiKey: string;
  /** The API, as this key. Every read and write of the owner's data goes here. */
  api: WorkerApi;
  /** Folders a repo scan may look in — the host's mounted vaults. */
  discoverWithin: () => string[];
  log: (message: string) => void;
  /** Whether to stream live narration (cc_summary) — paid-plan only. */
  streaming: boolean;
  /**
   * Which connection this runner authenticated as (api_keys.id), or null when
   * the web app could not say. Logged once so an owner with several runners can
   * tell them apart; the server attributes presence and sessions from the key
   * itself, so nothing here depends on it.
   */
  connectionId: string | null;
  /** See RunTicketWorkerOptions.claudeBin. */
  claudeBin: string | undefined;
  /** See RunTicketWorkerOptions.signal — this run's, which the lock can also end. */
  signal: AbortSignal | undefined;
}

// Fetch a project's MCP launch info from the web app: the config string (with
// ${NAME} refs) plus the env of just the secrets it references, decrypted
// server-side and scoped to this worker's owner. Nothing secret is stored on
// this machine. Returns {} (no MCP) on any failure so a transient issue doesn't
// block the run.
async function fetchMcpLaunch(
  ctx: Ctx,
  slug: string
): Promise<{ mcpConfig?: string; extraEnv?: Record<string, string> }> {
  try {
    const res = await fetch(
      `${ctx.appUrl}/api/v1/projects/${encodeURIComponent(slug)}/mcp`,
      { headers: { Authorization: `Bearer ${ctx.apiKey}` } }
    );
    if (!res.ok) {
      ctx.log(`mcp config fetch failed (${res.status}) for ${slug}`);
      return {};
    }
    const data = (await res.json()) as {
      mcpConfig?: McpConfig | null;
      env?: Record<string, string>;
    };
    if (
      !data.mcpConfig?.mcpServers ||
      Object.keys(data.mcpConfig.mcpServers).length === 0
    ) {
      return {};
    }
    return { mcpConfig: JSON.stringify(data.mcpConfig), extraEnv: data.env ?? {} };
  } catch (e) {
    ctx.log(`mcp config fetch error for ${slug}: ${errMsg(e as ErrLike)}`);
    return {};
  }
}

/** Wait `ms`, or less: an aborted signal ends it at once. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

const CANCEL_POLL_MS = 3000;
const HEARTBEAT_MS = 60_000;

// A throttled writer that streams Claude's compact live status (the latest
// action) into cc_summary so an open ticket modal shows what's happening now.
// Returns undefined when streaming is off (free plan) — the run still
// completes; it just isn't narrated live.
function narrationWriter(
  ctx: Ctx,
  ticketId: string
): ((text: string) => void) | undefined {
  if (!ctx.streaming) return undefined;
  let lastWrite = 0;
  let pending: string | null = null;
  return (text: string) => {
    pending = text;
    const now = Date.now();
    if (now - lastWrite < 1500) return; // throttle API writes / Realtime traffic
    lastWrite = now;
    const snapshot = pending;
    pending = null;
    ctx.api.patchTicket(ticketId, { cc_summary: snapshot }).catch(() => {});
  };
}

/**
 * Who this runner is, from its API key: whose jobs to claim, and which
 * connection it is claiming them as.
 *
 * Both answers come from one /api/v1/me call — the endpoint had to resolve the
 * token to say anything, so it reports the connection it resolved to. The two
 * halves fail differently, on purpose:
 *
 *   owner      — required. Without it there is nothing to claim, and a key the
 *                server refuses is a key that cannot work. Throws.
 *   connection — optional. It names this runner in the log; a web app that is
 *                briefly unreachable should not stop a runner from working.
 *                Null, and the log says so once.
 */
async function resolveIdentity(ctx: Ctx): Promise<{ ownerId: string; connectionId: string | null }> {
  const conn = await resolveWorkerConnection(ctx.appUrl, ctx.apiKey);
  if (conn) return { ownerId: conn.ownerId, connectionId: conn.connectionId };

  // No connection — either the app is down, the key is bad, or this is an older
  // server that does not report one. Fall back to the owner alone, which is the
  // behaviour every runner had before connections existed.
  const res = await fetch(`${ctx.appUrl}/api/v1/me`, {
    headers: { Authorization: `Bearer ${ctx.apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to resolve worker owner: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { owner_id?: string };
  if (!data.owner_id) throw new Error("/api/v1/me returned no owner_id");
  return { ownerId: data.owner_id, connectionId: null };
}

// Keep a running job + ticket "fresh" so reclaim_stale leaves them alone while
// the worker is alive and working. One call: the server bumps the job and its
// ticket together. Returns a stop() to clear the timer.
function startHeartbeat(ctx: Ctx, jobId: string): () => void {
  const tick = () => {
    ctx.api.heartbeat(jobId).catch(() => {});
  };
  const timer = setInterval(tick, HEARTBEAT_MS);
  return () => clearInterval(timer);
}

// Download attachment URLs to local temp files so Claude can open them with the
// Read tool. Returns the local paths; failed downloads are skipped.
async function downloadAttachments(
  urls: string[],
  log: Ctx["log"]
): Promise<string[]> {
  if (!urls.length) return [];
  const dir = await mkdtemp(join(tmpdir(), "cc-attach-"));
  const paths: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        log(`attachment fetch failed (${res.status}): ${url}`);
        continue;
      }
      const ext = extname(new URL(url).pathname) || ".bin";
      const path = join(dir, `${randomUUID()}${ext}`);
      await writeFile(path, Buffer.from(await res.arrayBuffer()));
      paths.push(path);
    } catch (e) {
      log(`attachment download error: ${url} ${errMsg(e as ErrLike)}`);
    }
  }
  return paths;
}

// What a finished run reports onto its ticket: the state, the session, and
// whatever the repo now shows — commits, a PR, a preview.
async function runOutcome(
  cwd: string,
  branch: string,
  result: { ok: boolean; sessionId: string | null; summary?: string | null; error?: string | null },
  withSummary: boolean
): Promise<TicketCcPatch> {
  const patch: TicketCcPatch = {
    cc_state: result.ok ? "done" : "error",
    cc_session_id: result.sessionId,
  };
  if (withSummary) patch.cc_summary = result.summary ?? result.error ?? null;
  const state = await getRepoState(cwd, branch);
  if (state) {
    patch.commits = state.commits;
    if (state.pr_id) {
      patch.pr_id = state.pr_id;
      patch.pr_title = state.pr_title;
      patch.pr_url = state.pr_url;
    }
  }
  const preview = await resolvePreviewUrl(cwd, branch);
  if (preview) patch.preview_url = preview;
  return patch;
}

// Execute a "dispatch" job: run Claude Code against the project's local repo.
async function runDispatch(job: Job, ctx: Ctx): Promise<{ canceled: boolean }> {
  const ticket = await ctx.api.getTicket(job.ticket_id);
  if (!ticket) throw new Error("ticket not found");
  const project = await ctx.api.getProject(ticket.project);
  if (!project?.local_path) throw new Error("project has no local_path");
  const cwd = project.local_path;
  const branch = ticket.cc_branch ?? "auto";

  // Resume a user-picked Claude session if it still exists on disk; otherwise
  // start fresh (the picked session may have been pruned since it was chosen).
  let sessionId: string = randomUUID();
  let resume = false;
  const seed = ticket.cc_seed_session_id;
  if (seed && (await sessionExists(seed))) {
    sessionId = seed;
    resume = true;
    ctx.log(`resuming picked session ${seed} for ticket ${ticket.id}`);
  } else if (seed) {
    ctx.log(`picked session ${seed} no longer exists — starting fresh`);
  }
  await ctx.api.patchTicket(ticket.id, {
    cc_state: "running",
    cc_session_id: sessionId,
    cc_summary: null,
    cc_last_run: new Date().toISOString(),
  });

  // The progress endpoint authenticates by the worker's API key (bearer) and
  // scopes writes to that owner's tickets — no shared token in the URL.
  const progressUrl = `${ctx.appUrl}/progress?ticket_id=${encodeURIComponent(ticket.id)}`;
  const attachments = await downloadAttachments(ticket.images ?? [], ctx.log);
  const mcp = await fetchMcpLaunch(ctx, ticket.project);

  let canceled = false;
  const stopHeartbeat = startHeartbeat(ctx, job.id);

  return new Promise<{ canceled: boolean }>((resolve) => {
    const session = startClaudeCodeSession({
      claudeBin: ctx.claudeBin,
      cwd,
      sessionId,
      resume,
      prompt: buildPrompt(ticket, project.name, progressUrl, attachments, ctx.apiKey),
      mcpConfig: mcp.mcpConfig,
      extraEnv: mcp.extraEnv,
      onText: narrationWriter(ctx, ticket.id),
      onComplete: async (result) => {
        clearInterval(poll);
        stopHeartbeat();
        try {
          if (canceled) return;
          await ctx.api.patchTicket(ticket.id, await runOutcome(cwd, branch, result, true));
          // Persist the run summary as the first assistant turn, so it becomes
          // part of the durable conversation (and isn't lost when a later chat
          // run overwrites the live cc_summary field).
          const reply = result.summary ?? result.error ?? "";
          if (reply) await ctx.api.addTicketMessage(ticket.id, reply);
        } finally {
          resolve({ canceled });
        }
      },
    });

    const poll = setInterval(async () => {
      try {
        const current = await ctx.api.getJob(job.id);
        if (current && current.status === "canceled" && !canceled) {
          canceled = true;
          ctx.log(`job ${job.id} canceled — stopping session`);
          session.cancel();
        }
      } catch {
        // transient API error — try again next tick
      }
    }, CANCEL_POLL_MS);
    // The host is stopping (Log out, quit, the lock taken over). Kill the
    // session and do NOT write a result: the job stays "running" with a
    // heartbeat that has stopped, which is what reclaim_stale hands to the
    // next worker. An "error" here would look like Claude failed the ticket.
    const abandon = (): void => {
      if (canceled) return;
      canceled = true;
      ctx.log(`job ${job.id} abandoned — this worker is stopping; it will be reclaimed`);
      session.cancel();
    };
    ctx.signal?.addEventListener("abort", abandon, { once: true });
  });
}

// Execute a "chat" job: resume the ticket's session with a follow-up message.
async function runChat(job: Job, ctx: Ctx): Promise<{ canceled: boolean }> {
  const ticket = await ctx.api.getTicket(job.ticket_id);
  if (!ticket) throw new Error("ticket not found");
  if (!ticket.cc_session_id) throw new Error("ticket has no session to resume");
  const project = await ctx.api.getProject(ticket.project);
  if (!project?.local_path) throw new Error("project has no local_path");
  const cwd = project.local_path;
  const branch = ticket.cc_branch ?? "auto";
  const message = job.payload?.message?.trim() ?? "";
  const attachments = await downloadAttachments(job.payload?.images ?? [], ctx.log);
  if (!message && attachments.length === 0) {
    throw new Error("chat job has no message or attachments");
  }
  // Same owner-scoped progress endpoint as dispatch — passed explicitly so a
  // resumed session uses the current URL + API-key auth, not a stale one.
  const progressUrl = `${ctx.appUrl}/progress?ticket_id=${encodeURIComponent(ticket.id)}`;

  await ctx.api.patchTicket(ticket.id, {
    cc_state: "running",
    cc_last_run: new Date().toISOString(),
  });

  let canceled = false;
  const stopHeartbeat = startHeartbeat(ctx, job.id);
  const mcp = await fetchMcpLaunch(ctx, ticket.project);

  return new Promise<{ canceled: boolean }>((resolve) => {
    const session = startClaudeCodeSession({
      claudeBin: ctx.claudeBin,
      cwd,
      sessionId: ticket.cc_session_id ?? undefined,
      resume: true,
      prompt: buildChatPrompt({
        message,
        title: ticket.title,
        description: ticket.description,
        attachmentPaths: attachments,
        autoCommit: ticket.auto_commit,
        progressUrl,
        progressToken: ctx.apiKey,
      }),
      mcpConfig: mcp.mcpConfig,
      extraEnv: mcp.extraEnv,
      onText: narrationWriter(ctx, ticket.id),
      onComplete: async (result) => {
        clearInterval(poll);
        stopHeartbeat();
        try {
          if (canceled) return;
          const reply = result.summary ?? result.error ?? "";
          if (reply) await ctx.api.addTicketMessage(ticket.id, reply);
          await ctx.api.patchTicket(ticket.id, await runOutcome(cwd, branch, result, false));
        } finally {
          resolve({ canceled });
        }
      },
    });

    const poll = setInterval(async () => {
      try {
        const current = await ctx.api.getJob(job.id);
        if (current && current.status === "canceled" && !canceled) {
          canceled = true;
          ctx.log(`job ${job.id} canceled — stopping session`);
          session.cancel();
        }
      } catch {
        // transient API error — try again next tick
      }
    }, CANCEL_POLL_MS);
    // The host is stopping (Log out, quit, the lock taken over). Kill the
    // session and do NOT write a result: the job stays "running" with a
    // heartbeat that has stopped, which is what reclaim_stale hands to the
    // next worker. An "error" here would look like Claude failed the ticket.
    const abandon = (): void => {
      if (canceled) return;
      canceled = true;
      ctx.log(`job ${job.id} abandoned — this worker is stopping; it will be reclaimed`);
      session.cancel();
    };
    ctx.signal?.addEventListener("abort", abandon, { once: true });
  });
}

// How often the worker re-checks its Claude Code version (and, for a CLI
// install, whether it is behind the published version).
const REPO_SWEEP_MS = 30 * 60_000;

// Report the local repos and sessions Claude Code has run in — but only inside
// the folders the host says this worker may look in (the mounted vaults). Runs
// on the admin "Rescan paths" request, never on a timer: a background scan
// over every folder Claude Code was ever run in had macOS asking for Desktop
// and Documents, folders nobody pointed Markbase at. Best-effort: a failure
// here must never disrupt job polling.
async function sweepRepos(ctx: Ctx): Promise<void> {
  try {
    const { repos, sessions } = await discoverClaude({ within: ctx.discoverWithin() });
    await ctx.api.reportRepos(repos);
    // The server stamps these with the connection the key is, so a session
    // discovered here is attributable to THIS machine rather than to the owner
    // in general.
    await ctx.api.reportSessions(sessions);
    ctx.log(
      `discovered ${repos.length} local repo${repos.length === 1 ? "" : "s"}, ` +
        `${sessions.length} session${sessions.length === 1 ? "" : "s"}`
    );
  } catch (e) {
    ctx.log(`repo sweep error: ${errMsg(e as ErrLike)}`);
  }
}

// How often the local folder mirror reconciles. Fast enough that saving a file in
// your editor lands in Markbase while you're still looking at it, slow enough not
// to hammer the API with a full document list.
const MIRROR_SWEEP_MS = 10_000;

// Reconcile the mirror, skipping the tick if the previous sweep is still going —
// a big workspace on a slow link must not stack up overlapping sweeps, which
// would race each other writing the same files.
function mirrorSweeper(ctx: Ctx, dir: string): () => void {
  let running = false;
  return () => {
    if (running) return;
    running = true;
    void syncMirror({ appUrl: ctx.appUrl, apiKey: ctx.apiKey, dir, log: ctx.log })
      .catch((e) => ctx.log(`mirror error: ${errMsg(e as ErrLike)}`))
      .finally(() => {
        running = false;
      });
  };
}

// Keep this connection's Claude Code version current. `markbase login` records
// it once; re-probing on the sweep means installing (or removing) Claude Code
// afterwards unlocks (or locks) the local-agent features without re-authing.
async function sweepClaudeVersion(ctx: Ctx): Promise<void> {
  try {
    await ctx.api.reportClaudeVersion(detectClaudeVersion(ctx.claudeBin));
  } catch (e) {
    ctx.log(`claude version report error: ${errMsg(e as ErrLike)}`);
  }
}

// Fulfil a worker auto-spawn request the server just handed us: launch a Claude
// Code session (seeded with "Hi, your name is <name>") in the project's local
// repo, pinned to the session id the server minted and already bound to the
// named agent slot (so the Agents page shows it live). Best-effort — a failure
// marks the request errored, never disrupts job polling.
async function runSpawn(ctx: Ctx, claimed: ClaimedSpawnRequest): Promise<void> {
  const { request: req, project, sessionId } = claimed;
  ctx.log(`spawning agent session (request ${req.id}, project ${req.project})`);
  try {
    if (!project?.local_path) {
      throw new Error(`project '${req.project}' has no local repo path`);
    }
    startClaudeCodeSession({
      claudeBin: ctx.claudeBin,
      cwd: project.local_path,
      prompt: req.prompt,
      sessionId,
      onComplete: (r) =>
        ctx.log(
          `agent session ${sessionId.slice(0, 8)} ${r.ok ? "done" : `error: ${r.error}`}`
        ),
    });
    await ctx.api.finishAgentRequest("spawn", req.id, "done");
  } catch (e) {
    await ctx.api.finishAgentRequest("spawn", req.id, "error", errMsg(e as ErrLike)).catch(() => {});
    ctx.log(`spawn error: ${errMsg(e as ErrLike)}`);
  }
}

// Deliver an @mention to an agent session: resume its Claude session and let it
// reply with a comment of its own. Resuming requires the directory the session
// was created in (`claude -r` is scoped to a project dir); when we don't know it,
// fall back to the user's home directory.
async function runMessage(ctx: Ctx, claimed: ClaimedMessageRequest): Promise<void> {
  const { request: req, session } = claimed;
  ctx.log(`delivering mention to agent session ${req.agent_session_id}`);
  try {
    if (!session) throw new Error("agent session not found");
    if (!session.external_session_id) {
      throw new Error("agent session was never started, nothing to resume");
    }
    if (session.status === "ended" || session.status === "missing") {
      throw new Error(`agent session is ${session.status}`);
    }

    const cwd = session.context?.repo_cwd || homedir();
    startClaudeCodeSession({
      claudeBin: ctx.claudeBin,
      cwd,
      prompt: req.prompt,
      sessionId: session.external_session_id,
      resume: true,
      // Lets the agent's doc calls be attributed back to this session.
      extraEnv: { MARKBASE_SESSION_TOKEN: session.session_token },
      onComplete: (r) =>
        ctx.log(
          `mention reply ${session.external_session_id?.slice(0, 8)} ${
            r.ok ? "done" : `error: ${r.error}`
          }`
        ),
    });
    await ctx.api.finishAgentRequest("message", req.id, "done");
  } catch (e) {
    await ctx.api.finishAgentRequest("message", req.id, "error", errMsg(e as ErrLike)).catch(() => {});
    ctx.log(`mention delivery error: ${errMsg(e as ErrLike)}`);
  }
}

// Drain one agent request of each kind: the oldest queued spawn, the oldest
// queued mention. Listed in one call, claimed by id; a claim that comes back
// null was taken by another worker and is nobody's problem here.
async function drainAgentRequests(ctx: Ctx): Promise<void> {
  let queued;
  try {
    queued = await ctx.api.listAgentRequests();
  } catch (e) {
    ctx.log(`agent request poll error: ${errMsg(e as ErrLike)}`);
    return;
  }
  const spawn = queued.spawn[0];
  if (spawn) {
    try {
      const claimed = await ctx.api.claimAgentRequest("spawn", spawn.id);
      if (claimed?.kind === "spawn") await runSpawn(ctx, claimed);
    } catch (e) {
      ctx.log(`spawn poll error: ${errMsg(e as ErrLike)}`);
    }
  }
  const message = queued.message[0];
  if (message) {
    try {
      const claimed = await ctx.api.claimAgentRequest("message", message.id);
      if (claimed?.kind === "message") await runMessage(ctx, claimed);
    } catch (e) {
      ctx.log(`mention poll error: ${errMsg(e as ErrLike)}`);
    }
  }
}

// Warn (loudly) when this worker is behind the latest published @markbase/cli,
// so a long-running process doesn't silently miss new features (e.g. agent
// auto-spawn). Best-effort — a registry hiccup or offline box is ignored. Set
// MARKBASE_WORKER_EXIT_WHEN_OUTDATED=1 to exit instead, so a KeepAlive service
// relaunches into @latest.
async function checkForUpdate(
  ctx: Ctx,
  currentVersion: string | undefined
): Promise<void> {
  if (!currentVersion) return;
  const latest = await fetchLatestCliVersion();
  if (!latest || !isVersionBehind(currentVersion, latest)) return;

  ctx.log(
    `⚠ update available — running ${currentVersion}, latest is ${latest}. ` +
      `Run \`npx -y @markbase/cli@latest update\` to upgrade and restart the service.`
  );
  if (process.env.MARKBASE_WORKER_EXIT_WHEN_OUTDATED === "1") {
    ctx.log("MARKBASE_WORKER_EXIT_WHEN_OUTDATED=1 — exiting so the service relaunches into @latest.");
    process.exit(0);
  }
}

/**
 * Hold this machine's worker lock, waiting for it if another process has it.
 *
 * Resolves with the lock, or null if `signal` aborted first. `onLost` fires if
 * the lock is taken from us later — a stale-looking record that a livelier
 * process claimed — and the caller stops claiming jobs it no longer owns.
 */
async function waitForWorkerLock(
  owner: string,
  log: (m: string) => void,
  signal: AbortSignal,
  onLost: (holder: VaultLockInfo) => void,
  onWaiting: (holder: VaultLockInfo) => void
): Promise<VaultLock | null> {
  let said: string | null = null;
  for (;;) {
    if (signal.aborted) return null;
    try {
      const lock = acquireWorkerLock(owner, onLost);
      if (said) log("the other process let go — running tickets here now");
      return lock;
    } catch (e) {
      if (!(e instanceof VaultLockedError)) throw e;
      // Once per holder, not once per retry: a service that waits all day must
      // not fill the log saying so every ten seconds.
      const line = `another Markbase process is running tickets on this machine — the ${e.holder.owner} (pid ${e.holder.pid}); will take over when it lets go`;
      if (line !== said) {
        said = line;
        log(line);
        onWaiting(e.holder);
      }
      await sleep(LOCK_RETRY_MS, signal);
    }
  }
}

/** How often a worker that is waiting for the lock looks again. */
const LOCK_RETRY_MS = 10_000;

// Claim and run this owner's queued jobs — forever, or until `signal` says
// stop. Resolves the owner from the API key first (throws if the key is
// missing/invalid). With `lockOwner`, a worker that loses the lock goes back to
// waiting for it rather than returning: from the host's point of view the
// worker is still "on", it just is not the one running tickets right now.
export async function runTicketWorker(
  opts: RunTicketWorkerOptions
): Promise<void> {
  if (!opts.apiKey) {
    throw new Error(
      "No API key — create one in the dashboard and configure it so the worker knows whose jobs to run."
    );
  }
  const log = opts.log ?? ((m) => console.log(`[worker] ${m}`));

  for (;;) {
    if (opts.signal?.aborted) return;
    // This run's signal: the host's, plus the lock being taken from under us.
    const run = new AbortController();
    const stop = (): void => run.abort();
    opts.signal?.addEventListener("abort", stop, { once: true });
    let lock: VaultLock | null = null;
    try {
      if (opts.lockOwner) {
        lock = await waitForWorkerLock(
          opts.lockOwner,
          log,
          run.signal,
          (holder) => {
            log(`the ${holder.owner} (pid ${holder.pid}) took over running tickets — standing down`);
            run.abort();
          },
          (holder) => opts.onState?.({ kind: "waiting", holder })
        );
        if (!lock) return;
      }
      await claimLoop(opts, log, run.signal);
    } finally {
      opts.signal?.removeEventListener("abort", stop);
      lock?.release();
    }
    // Without a lock there is nothing to wait for again: the loop only ends
    // because the host said stop.
    if (!opts.lockOwner || opts.signal?.aborted) return;
  }
}

/** The worker proper: identity, the sweeps, and the claim loop, until `signal`. */
async function claimLoop(
  opts: RunTicketWorkerOptions,
  log: (m: string) => void,
  signal: AbortSignal
): Promise<void> {
  const appUrl = opts.appUrl.replace(/\/+$/, "");
  const ctx: Ctx = {
    appUrl,
    apiKey: opts.apiKey,
    api: new WorkerApi(appUrl, opts.apiKey, { fetch: opts.fetch }),
    discoverWithin: opts.discoverWithin ?? (() => []),
    log,
    streaming: false,
    // Filled in by resolveIdentity below, once /api/v1/me has answered. Null
    // until then, and null forever if it cannot — a runner without a connection
    // still claims work.
    connectionId: null,
    claudeBin: opts.claudeBin,
    signal,
  };
  const pollMs = opts.pollMs ?? 3000;

  const { ownerId, connectionId } = await resolveIdentity(ctx);
  ctx.connectionId = connectionId;
  // Live narration is a paid-plan feature; resolved once at startup. A server
  // that cannot answer right now leaves it off rather than stopping the worker:
  // narration is a nicety, claiming work is the job.
  try {
    ctx.streaming = (await ctx.api.getPlan()) === "pro";
  } catch (e) {
    if (e instanceof WorkerApiError && e.fatal) throw e;
    ctx.log(`plan lookup error: ${errMsg(e as ErrLike)} — live streaming off for this run`);
  }
  ctx.log(
    `started — polling for owner ${ownerId}'s queued jobs… (live streaming: ${ctx.streaming ? "on" : "off"})`
  );
  // Said once, at startup: an owner with two runners needs to know which one
  // this is, and a runner with no connection needs to say so rather than look
  // identical to one that has it.
  ctx.log(
    connectionId
      ? `connection ${connectionId}`
      : "no connection identity — presence and sessions will be unattributed"
  );

  // No repo scan here. It used to run at startup and every half hour over
  // every folder Claude Code had been run in; now a folder is registered when
  // the person runs Claude Code in it through Markbase (reportClaudeRun), and
  // the admin "Rescan paths" request sweeps the mounted folders on demand.
  void sweepClaudeVersion(ctx);
  const timers: ReturnType<typeof setInterval>[] = [];
  const every = (ms: number, fn: () => void): void => {
    const t = setInterval(fn, ms);
    t.unref?.();
    timers.push(t);
  };
  every(REPO_SWEEP_MS, () => {
    void sweepClaudeVersion(ctx);
  });

  // Nudge the operator when this long-running worker is behind the published
  // CLI — checked once at startup, then on the same slow cadence as the sweep.
  if (opts.checkForUpdates !== false) {
    void checkForUpdate(ctx, opts.version);
    every(REPO_SWEEP_MS, () => void checkForUpdate(ctx, opts.version));
  }

  // The local folder mirror — documents as .md files on this machine, both ways.
  if (opts.mirrorDir) {
    ctx.log(`mirroring documents to ${opts.mirrorDir}`);
    const sweep = mirrorSweeper(ctx, opts.mirrorDir);
    sweep();
    every(MIRROR_SWEEP_MS, sweep);
  }

  try {
    opts.onState?.({ kind: "idle" });
    // Consecutive claim failures. A server that isn't answering is asked less
    // often each time, not every 3 s forever — see poll-backoff. A key it
    // REFUSES is not a failure to wait out: that ends the run, and the host
    // says so (the tray's "failed", the CLI's exit).
    let claimFailures = 0;
    // The first claim also runs the staleness sweep, as the worker always did
    // once at startup (the server schedules it too; this covers a database
    // without the cron).
    let reclaim = true;
    while (!signal.aborted) {
      let job: Job | null = null;
      let rescan = false;
      try {
        ({ job, rescan } = await ctx.api.claim({ version: opts.version, reclaim }));
        reclaim = false;
        claimFailures = 0;
      } catch (e) {
        if (e instanceof WorkerApiError && e.fatal) {
          throw new Error(`the API refused this worker's key: ${e.message}`);
        }
        claimFailures++;
        const wait = nextPollDelay(pollMs, claimFailures);
        ctx.log(`claim error: ${errMsg(e as ErrLike)} — retrying in ${Math.round(wait / 1000)}s`);
        await sleep(wait, signal);
        continue;
      }
      if (!job) {
        // Honor an on-demand rescan request (admin "Rescan paths" button) on the
        // idle path. The only scan there is, and it stays inside the mounted
        // folders.
        if (rescan) await sweepRepos(ctx);
        // Drain one agent auto-spawn request and one @mention delivery per idle
        // tick (~3s responsiveness).
        await drainAgentRequests(ctx);
        await sleep(pollMs, signal);
        continue;
      }

      ctx.log(`claimed ${job.kind} job ${job.id} (ticket ${job.ticket_id})`);
      opts.onState?.({ kind: "job", ticketId: job.ticket_id });
      try {
        let canceled = false;
        if (job.kind === "dispatch") {
          ({ canceled } = await runDispatch(job, ctx));
        } else if (job.kind === "chat") {
          ({ canceled } = await runChat(job, ctx));
        } else {
          throw new Error(`unsupported job kind: ${job.kind}`);
        }
        if (canceled) {
          // Either the user canceled it, or we are stopping — the abandon
          // handler said which. Neither is finished.
          if (!signal.aborted) ctx.log(`job ${job.id} canceled`);
        } else {
          await ctx.api.finishJob(job.id, "done");
          ctx.log(`job ${job.id} done`);
        }
      } catch (e) {
        const msg = errMsg(e as ErrLike);
        ctx.log(`job ${job.id} failed: ${msg}`);
        try {
          await ctx.api.finishJob(job.id, "error", msg);
          await ctx.api.patchTicket(job.ticket_id, { cc_state: "error", cc_summary: msg });
        } catch {
          // best-effort
        }
      } finally {
        opts.onState?.({ kind: "idle" });
      }
    }
    ctx.log("stopped");
  } finally {
    for (const t of timers) clearInterval(t);
  }
}
