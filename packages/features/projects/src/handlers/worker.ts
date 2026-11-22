import { randomUUID } from "node:crypto";
import {
  claimNextJob,
  finishJob,
  getOwnedJob,
  heartbeatJob,
  reclaimStale,
} from "@markbase/server/db/jobs";
import {
  claimMessageRequest,
  claimSpawnRequest,
  finishMessageRequest,
  finishSpawnRequest,
  getAgentSessionById,
  listQueuedAgentRequests,
  setAgentSessionExternalId,
} from "@markbase/server/db/agent-sessions";
import {
  getProject,
  getTicket,
  updateProject,
  updateTicket,
  updateTicketCc,
} from "@markbase/server/db/tickets";
import {
  clearRefreshRequest,
  listRefreshRequests,
  saveProjectBranches,
} from "@markbase/server/db/worker-refresh";
import { normalizeRemote } from "@markbase/shared/git-remote";
import type { TicketCcPatch } from "@markbase/shared/tickets";
import {
  projectRepoReportFrom,
  ticketSyncReportFrom,
  type ProjectRepoReportBody,
  type TicketSyncReportBody,
} from "@markbase/shared/worker-refresh";
import { getUserPlan } from "@markbase/server/db/plans";
import {
  isRepoStatus,
  type DiscoveredRepo,
  type DiscoveredSession,
} from "@markbase/shared/worker-repos";
import {
  reportWorkerRepos,
  reportWorkerSessions,
  takeRepoRescan,
} from "@markbase/server/db/worker-repos";
import { setClaudeVersion } from "@markbase/server/api-keys";
import { connection, owner, type HandlerHost } from "./host";

// The ticket worker's API (security lockdown stage 2).
//
// The CLI worker and the desktop app used to reach these tables over PostgREST
// with the publishable key, and told the RPCs whose jobs to claim. Anyone with
// that key — it ships in the browser bundle and the npm package — could claim,
// read or finish any owner's jobs by naming them. Now the worker sends its API
// key, the key names the owner, and nothing in a request body does. A job,
// request or ticket that is not this owner's is not found, never forbidden:
// there is nothing to learn from the difference.

/** A UUID, as a path param must be before it reaches a query. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function jsonBody<T extends object>(req: Request): Promise<T | null> {
  try {
    const body = (await req.json()) as T | null;
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

/** The ISO timestamp of a discovered thing, or null when it isn't one. */
function isoOrNull(v: string | null | undefined): string | null {
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null;
}

export function workerClaimHandler(host: HandlerHost) {
  const { json } = host;
  // POST { version?, reclaim? } — claim the next queued job for the key's
  // owner, stamping presence (and the version) either way. Answers
  // { job, rescan, refresh }: `rescan` is the admin's pending "Rescan paths"
  // request, taken atomically, reported only on the idle path as the worker
  // always handled it. `refresh` is the tickets and projects waiting for a
  // lookup in their local repo (see workerTicketSyncHandler), also idle-only:
  // a worker that has a job is about to be busy. `reclaim` runs the staleness
  // sweep first — once, at startup.
  return async (req: Request): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;

    const body = (await jsonBody<{ version?: string | null; reclaim?: boolean }>(req)) ?? {};
    const version = typeof body.version === "string" && body.version.trim() ? body.version.trim() : undefined;

    if (body.reclaim === true) await reclaimStale();
    const job = await claimNextJob(a.ownerId, version);
    const rescan = job ? false : await takeRepoRescan(a.ownerId);
    const refresh = job ? { tickets: [], projects: [] } : await listRefreshRequests(a.ownerId);
    return json({ job, rescan, refresh });
  };
}

export function workerHeartbeatHandler(host: HandlerHost) {
  const { json } = host;
  // POST { jobId } — keep a running job and its ticket fresh, so reclaim_stale
  // leaves a long-but-healthy run alone. The ticket is the job's own; the
  // worker does not get to name one.
  return async (req: Request): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;

    const body = await jsonBody<{ jobId?: string }>(req);
    if (!body || typeof body.jobId !== "string" || !UUID_RE.test(body.jobId)) {
      return json({ error: "jobId is required" }, 400);
    }
    const job = await getOwnedJob(a.ownerId, body.jobId);
    if (!job) return json({ error: "Job not found" }, 404);

    await heartbeatJob(job.id);
    await updateTicketCc(job.ticket_id, { cc_last_run: new Date().toISOString() });
    return json({ ok: true });
  };
}

export function workerJobHandler(host: HandlerHost) {
  const { json } = host;
  return {
    // GET — the job as it is now. A run polls this to notice it was cancelled.
    GET: async (req: Request, id: string): Promise<Response> => {
      const a = await owner(req, "read", host);
      if ("error" in a) return a.error;
      if (!UUID_RE.test(id)) return json({ error: "Job not found" }, 404);
      const job = await getOwnedJob(a.ownerId, id);
      if (!job) return json({ error: "Job not found" }, 404);
      return json({ job });
    },
  };
}

export function workerJobFinishHandler(host: HandlerHost) {
  const { json } = host;
  // POST { status: "done" | "error", error? } — the run is over.
  return async (req: Request, id: string): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;
    if (!UUID_RE.test(id)) return json({ error: "Job not found" }, 404);

    const body = await jsonBody<{ status?: string; error?: string | null }>(req);
    if (!body || (body.status !== "done" && body.status !== "error")) {
      return json({ error: "status must be 'done' or 'error'" }, 400);
    }
    const job = await getOwnedJob(a.ownerId, id);
    if (!job) return json({ error: "Job not found" }, 404);

    await finishJob(job.id, body.status, typeof body.error === "string" ? body.error : undefined);
    return json({ ok: true });
  };
}

export function workerReposHandler(host: HandlerHost) {
  const { json } = host;
  // POST { repos: [{ cwd, remote, branch, status, lastActive }] } — replace
  // this owner's discovered repos with the set the worker just scanned.
  return async (req: Request): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;

    const body = await jsonBody<{ repos?: Partial<DiscoveredRepo>[] }>(req);
    if (!body || !Array.isArray(body.repos)) {
      return json({ error: "repos must be an array" }, 400);
    }
    const repos: DiscoveredRepo[] = [];
    for (const r of body.repos) {
      if (!r || typeof r.cwd !== "string" || !r.cwd || !isRepoStatus(r.status)) continue;
      const lastActive = isoOrNull(r.lastActive);
      if (!lastActive) continue;
      repos.push({
        cwd: r.cwd,
        remote: typeof r.remote === "string" ? r.remote : null,
        branch: typeof r.branch === "string" ? r.branch : null,
        status: r.status,
        lastActive,
      });
    }
    await reportWorkerRepos(a.ownerId, repos);
    return json({ ok: true, count: repos.length });
  };
}

export function workerTicketSyncHandler(host: HandlerHost) {
  const { json } = host;
  // POST { commits, pr_id, pr_title, pr_url, review_requested, preview_url } —
  // the worker's answer to a ticket refresh: what the ticket's branch shows in
  // the project's local repo right now. The web server used to run git and gh
  // for this itself, which only worked when it shared a disk with the
  // checkout; the worker is on that disk, so it looks and reports.
  //
  // Only what was found is written. A lookup that found no PR or no preview
  // leaves the ticket's fields as they were, as the old routes did. A pending
  // review request moves the ticket to "review_requested"; none pending leaves
  // the status alone (the reviewer may have responded).
  return async (req: Request, id: string): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;
    if (!UUID_RE.test(id)) return json({ error: "Ticket not found" }, 404);

    const ticket = await getTicket(id, a.ownerId);
    if (!ticket) return json({ error: "Ticket not found" }, 404);

    const body = await jsonBody<TicketSyncReportBody>(req);
    if (!body) return json({ error: "Invalid JSON" }, 400);
    const report = ticketSyncReportFrom(body);

    const patch: TicketCcPatch = { commits: report.commits };
    if (report.pr_id) {
      patch.pr_id = report.pr_id;
      patch.pr_title = report.pr_title;
      patch.pr_url = report.pr_url;
    }
    if (report.preview_url) patch.preview_url = report.preview_url;
    await updateTicketCc(id, patch);

    if (report.pr_id && report.review_requested) {
      await updateTicket(id, { status: "review_requested" }, a.ownerId);
    }
    await clearRefreshRequest(a.ownerId, "ticket", id);
    return json({ ok: true });
  };
}

export function workerProjectRepoHandler(host: HandlerHost) {
  const { json } = host;
  // POST { branches, default, current, remote } — the worker's answer to a
  // project refresh: the branches of the project's local repo and its origin
  // remote. The branches are stored on the project for the new-ticket picker.
  // The remote fills the project's GitHub link only when it has none, which is
  // what creating a project used to do by reading the repo off the server's
  // own disk.
  return async (req: Request, slug: string): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;

    const project = await getProject(slug, a.ownerId);
    if (!project) return json({ error: "Project not found" }, 404);

    const body = await jsonBody<ProjectRepoReportBody>(req);
    const report = body ? projectRepoReportFrom(body) : null;
    if (!report) return json({ error: "branches must be an array" }, 400);

    await saveProjectBranches(a.ownerId, slug, report);
    if (!project.github_repo && report.remote) {
      await updateProject(
        slug,
        { github_repo: normalizeRemote(report.remote) ?? report.remote },
        a.ownerId
      );
    }
    await clearRefreshRequest(a.ownerId, "project", slug);
    return json({ ok: true });
  };
}

export function workerSessionsHandler(host: HandlerHost) {
  const { json } = host;
  // POST { sessions: [{ sessionId, repoCwd, title, lastActive }] } — replace
  // this owner's discovered Claude sessions, attributed to the key that
  // reported them. The worker used to look its connection up and pass it; the
  // server knows it from the bearer token, so nothing in the body says it.
  return async (req: Request): Promise<Response> => {
    const c = await connection(req, "write", host);
    if ("error" in c) return c.error;

    const body = await jsonBody<{ sessions?: Partial<DiscoveredSession>[] }>(req);
    if (!body || !Array.isArray(body.sessions)) {
      return json({ error: "sessions must be an array" }, 400);
    }
    const sessions: DiscoveredSession[] = [];
    for (const s of body.sessions) {
      if (!s || typeof s.sessionId !== "string" || !s.sessionId) continue;
      if (typeof s.repoCwd !== "string" || !s.repoCwd) continue;
      const lastActive = isoOrNull(s.lastActive);
      if (!lastActive) continue;
      sessions.push({
        sessionId: s.sessionId,
        repoCwd: s.repoCwd,
        title: typeof s.title === "string" ? s.title : null,
        lastActive,
      });
    }
    await reportWorkerSessions(c.ownerId, sessions, c.keyId);
    return json({ ok: true, count: sessions.length });
  };
}

export function workerAgentRequestsHandler(host: HandlerHost) {
  const { json } = host;
  // GET — the queued spawn and mention requests waiting for this owner's
  // worker, oldest first. The worker claims one by id.
  return async (req: Request): Promise<Response> => {
    const a = await owner(req, "read", host);
    if ("error" in a) return a.error;
    return json(await listQueuedAgentRequests(a.ownerId));
  };
}

type RequestKind = "spawn" | "message";

function isRequestKind(v: string | null | undefined): v is RequestKind {
  return v === "spawn" || v === "message";
}

export function workerAgentRequestClaimHandler(host: HandlerHost) {
  const { json } = host;
  // POST { kind } — take one request, and answer with everything the worker
  // needs to act on it, so it never reads agent_sessions or projects itself:
  //   spawn   → the project to launch in, and a fresh Claude session id already
  //             bound to the agent slot (the Agents page shows it live at once)
  //   message → the session to resume, token included (it runs on that machine)
  // 409 when another worker got there first; 404 when it is not this owner's.
  return async (req: Request, id: string): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;
    if (!UUID_RE.test(id)) return json({ error: "Request not found" }, 404);

    const body = await jsonBody<{ kind?: string }>(req);
    if (!body || !isRequestKind(body.kind)) {
      return json({ error: "kind must be 'spawn' or 'message'" }, 400);
    }

    if (body.kind === "spawn") {
      const request = await claimSpawnRequest(a.ownerId, id);
      if (!request) return json({ error: "Request not found or already claimed" }, 409);
      const project = await getProject(request.project, a.ownerId);
      const sessionId = randomUUID();
      if (project?.local_path) {
        // Bind up front: the id is known before launch, so no claim round-trip.
        // The cwd too — `claude -r` only finds a session from the directory it
        // was created in, so without it the session could never be resumed.
        await setAgentSessionExternalId({
          ownerId: a.ownerId,
          agentSessionId: request.agent_session_id,
          externalSessionId: sessionId,
          repoCwd: project.local_path,
        });
      }
      return json({
        kind: "spawn",
        request,
        project: project?.local_path
          ? { slug: project.slug, name: project.name, local_path: project.local_path }
          : null,
        sessionId,
      });
    }

    const request = await claimMessageRequest(a.ownerId, id);
    if (!request) return json({ error: "Request not found or already claimed" }, 409);
    const session = await getAgentSessionById(a.ownerId, request.agent_session_id);
    return json({
      kind: "message",
      request,
      session: session
        ? {
            id: session.id,
            external_session_id: session.external_session_id,
            status: session.status,
            context: session.context,
            session_token: session.session_token,
          }
        : null,
    });
  };
}

export function workerAgentRequestFinishHandler(host: HandlerHost) {
  const { json } = host;
  // POST { kind, status: "done" | "error", error? }
  return async (req: Request, id: string): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;
    if (!UUID_RE.test(id)) return json({ error: "Request not found" }, 404);

    const body = await jsonBody<{ kind?: string; status?: string; error?: string | null }>(req);
    if (!body || !isRequestKind(body.kind)) {
      return json({ error: "kind must be 'spawn' or 'message'" }, 400);
    }
    if (body.status !== "done" && body.status !== "error") {
      return json({ error: "status must be 'done' or 'error'" }, 400);
    }
    const message = typeof body.error === "string" ? body.error : undefined;
    const finished =
      body.kind === "spawn"
        ? await finishSpawnRequest(a.ownerId, id, body.status, message)
        : await finishMessageRequest(a.ownerId, id, body.status, message);
    if (!finished) return json({ error: "Request not found" }, 404);
    return json({ ok: true });
  };
}

export function workerClaudeVersionHandler(host: HandlerHost) {
  const { json } = host;
  // PATCH { version: string | null } — this machine's `claude --version`,
  // recorded on the key that made the request. A session has no key to record
  // it on: a browser is not a machine that runs Claude.
  return async (req: Request): Promise<Response> => {
    const c = await connection(req, "write", host);
    if ("error" in c) return c.error;
    if (!c.keyId) return json({ error: "Only an API key has a Claude version" }, 400);

    const body = await jsonBody<{ version?: string | null }>(req);
    if (!body || (body.version !== null && typeof body.version !== "string")) {
      return json({ error: "version must be a string or null" }, 400);
    }
    await setClaudeVersion(c.keyId, c.ownerId, body.version);
    return json({ ok: true });
  };
}

export function myPlanHandler(host: HandlerHost) {
  const { json } = host;
  // GET — the caller's plan. The worker reads it once at startup to decide
  // whether to narrate runs live (a paid feature).
  return async (req: Request): Promise<Response> => {
    const a = await owner(req, "read", host);
    if ("error" in a) return a.error;
    return json({ plan: await getUserPlan(a.ownerId) });
  };
}
