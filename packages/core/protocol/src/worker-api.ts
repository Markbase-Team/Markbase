// The ticket worker's client for the web API.
//
// Security lockdown stage 2: the worker used to reach the database directly
// with the publishable key, and passed its own owner id to RPCs that trusted
// it. Now every call carries this machine's API key as a bearer token, the
// server resolves the key to its owner, and nothing the worker sends names an
// owner. The server is the only thing holding a database credential.
//
// One class, injected fetch, so the worker's behaviour on each kind of failure
// is a decision made here and tested without a server:
//
//   5xx, 429, a dropped connection  — retryable: the loop backs off and asks again
//   401 / 403                        — fatal: the key is wrong, revoked or capped.
//                                      Retrying cannot help, so the host is told.
//   404                              — null where "not there" is an answer
//                                      (a job, a ticket, a project); an error
//                                      elsewhere.

import type { Job } from "./jobs";
import type {
  AgentMessageRequest,
  AgentSession,
  AgentSpawnRequest,
} from "./agent-sessions";
import type { TicketCcPatch } from "./tickets";
import type { Project, Ticket } from "./types";
import type { DiscoveredRepo, DiscoveredSession } from "./worker-repos";

export class WorkerApiError extends Error {
  /** The HTTP status, or 0 when no response arrived at all. */
  readonly status: number;
  /** The request that failed, for the log line. */
  readonly path: string;

  constructor(status: number, path: string, message: string) {
    super(message);
    this.name = "WorkerApiError";
    this.status = status;
    this.path = path;
  }

  /** The key was refused. Nothing a retry can fix; the host should report it. */
  get fatal(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** The server or the network failed. Ask again later, backed off. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export type AgentRequestKind = "spawn" | "message";

/** What `POST /worker/claim` answers. */
export interface ClaimResult {
  job: Job | null;
  /**
   * The admin asked for a repo rescan (the "Rescan paths" button). Taken
   * atomically by the server, so it is true exactly once per request — and
   * only reported when there was no job, the same idle path it always ran on.
   */
  rescan: boolean;
}

/** Everything the worker needs to act on a spawn request it just claimed. */
export interface ClaimedSpawnRequest {
  kind: "spawn";
  request: AgentSpawnRequest;
  /** The project to launch in; null when it has no local repo path. */
  project: Pick<Project, "slug" | "name" | "local_path"> | null;
  /**
   * The Claude session id to launch with. Minted and bound to the agent slot
   * server-side at claim time, so the Agents page shows the session live before
   * the first token — the same "bind up front" the worker used to do itself.
   */
  sessionId: string;
}

/** Everything the worker needs to deliver a mention it just claimed. */
export interface ClaimedMessageRequest {
  kind: "message";
  request: AgentMessageRequest;
  /** The session to resume; null when the agent slot no longer exists. */
  session: Pick<
    AgentSession,
    "id" | "external_session_id" | "status" | "context" | "session_token"
  > | null;
}

export type ClaimedAgentRequest = ClaimedSpawnRequest | ClaimedMessageRequest;

export interface WorkerApiDeps {
  /** Injected for tests; production uses the global fetch. */
  fetch?: typeof globalThis.fetch;
}

interface ErrorBody {
  error?: string;
}

export class WorkerApi {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly doFetch: typeof globalThis.fetch;

  constructor(appUrl: string, apiKey: string, deps: WorkerApiDeps = {}) {
    this.base = `${appUrl.replace(/\/+$/, "")}/api/v1`;
    this.apiKey = apiKey;
    this.doFetch = deps.fetch ?? globalThis.fetch;
  }

  // ---- jobs -----------------------------------------------------------------

  /**
   * Claim the next queued job for this key's owner, stamping presence either
   * way. `reclaim` also runs the staleness sweep first — the worker did that
   * once at startup, and still does.
   */
  claim(opts: { version?: string | null; reclaim?: boolean } = {}): Promise<ClaimResult> {
    return this.call<ClaimResult>("POST", "/worker/claim", {
      version: opts.version ?? null,
      reclaim: opts.reclaim === true,
    });
  }

  /** Keep a running job (and its ticket) fresh, so reclaim_stale leaves it alone. */
  async heartbeat(jobId: string): Promise<void> {
    await this.call("POST", "/worker/heartbeat", { jobId });
  }

  async finishJob(jobId: string, status: "done" | "error", error?: string): Promise<void> {
    await this.call("POST", `/worker/jobs/${encodeURIComponent(jobId)}/finish`, {
      status,
      error: error ?? null,
    });
  }

  /** The job as the server sees it now — how a run notices it was cancelled. */
  async getJob(jobId: string): Promise<Job | null> {
    const res = await this.call<{ job: Job }>(
      "GET",
      `/worker/jobs/${encodeURIComponent(jobId)}`,
      undefined,
      { nullOn404: true }
    );
    return res?.job ?? null;
  }

  // ---- discovery ------------------------------------------------------------

  /** Replace this owner's discovered repos with the current set. */
  async reportRepos(repos: DiscoveredRepo[]): Promise<void> {
    await this.call("POST", "/worker/repos", { repos });
  }

  /**
   * Replace this owner's discovered sessions with the current set. The server
   * attributes them to the connection the key is — the worker no longer has to
   * know its own connection id to say which machine saw them.
   */
  async reportSessions(sessions: DiscoveredSession[]): Promise<void> {
    await this.call("POST", "/worker/sessions", { sessions });
  }

  /** Record (or clear) this machine's Claude Code version on its own key. */
  async reportClaudeVersion(version: string | null): Promise<void> {
    await this.call("PATCH", "/worker/claude-version", { version });
  }

  // ---- agent requests -------------------------------------------------------

  /** Queued spawn and mention requests for this owner, oldest first. */
  listAgentRequests(): Promise<{ spawn: AgentSpawnRequest[]; message: AgentMessageRequest[] }> {
    return this.call("GET", "/worker/agent-requests");
  }

  /**
   * Take one request. Null when another worker got there first (409) or it is
   * gone (404) — either way there is nothing for this worker to do with it.
   */
  async claimAgentRequest(kind: AgentRequestKind, id: string): Promise<ClaimedAgentRequest | null> {
    const res = await this.call<ClaimedAgentRequest>(
      "POST",
      `/worker/agent-requests/${encodeURIComponent(id)}/claim`,
      { kind },
      { nullOn404: true, nullOn409: true }
    );
    return res ?? null;
  }

  async finishAgentRequest(
    kind: AgentRequestKind,
    id: string,
    status: "done" | "error",
    error?: string
  ): Promise<void> {
    await this.call("POST", `/worker/agent-requests/${encodeURIComponent(id)}/finish`, {
      kind,
      status,
      error: error ?? null,
    });
  }

  // ---- tickets, plan, projects ---------------------------------------------

  async getTicket(id: string): Promise<Ticket | null> {
    const res = await this.call<{ ticket: Ticket }>(
      "GET",
      `/tickets/${encodeURIComponent(id)}`,
      undefined,
      { nullOn404: true }
    );
    return res?.ticket ?? null;
  }

  /** Report a run's progress onto its ticket — the cc_* fields and the PR. */
  async patchTicket(id: string, patch: TicketCcPatch): Promise<void> {
    await this.call("PATCH", `/tickets/${encodeURIComponent(id)}`, patch);
  }

  /** Post the run's reply into the ticket's thread. */
  async addTicketMessage(id: string, content: string): Promise<void> {
    await this.call("POST", `/tickets/${encodeURIComponent(id)}/messages`, {
      role: "assistant",
      content,
    });
  }

  /** The owner's plan ("free" | "pro") — gates live narration. */
  async getPlan(): Promise<string> {
    const res = await this.call<{ plan: string }>("GET", "/me/plan");
    return res.plan;
  }

  async getProject(slug: string): Promise<Project | null> {
    const res = await this.call<{ project: Project }>(
      "GET",
      `/projects/${encodeURIComponent(slug)}`,
      undefined,
      { nullOn404: true }
    );
    return res?.project ?? null;
  }

  // ---- transport ------------------------------------------------------------

  private async call<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: object,
    opts: { nullOn404?: boolean; nullOn409?: boolean } = {}
  ): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await this.doFetch(`${this.base}${path}`, init);
    } catch (e) {
      // No response at all: DNS, a refused connection, a timeout. The server
      // may be fine in a moment — retryable.
      const why = e instanceof Error ? e.message : String(e);
      throw new WorkerApiError(0, path, `${method} ${path}: ${why}`);
    }

    if (res.status === 404 && opts.nullOn404) return null as T;
    if (res.status === 409 && opts.nullOn409) return null as T;

    // A body that isn't JSON (a proxy's HTML error page, an empty 204) must not
    // surface as "Unexpected token <" — the status is the more useful answer.
    const text = await res.text().catch(() => "");
    let parsed: (T & ErrorBody) | null = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as T & ErrorBody;
      } catch {
        parsed = null;
      }
    }

    if (!res.ok) {
      const detail = parsed?.error ?? (text ? text.slice(0, 200) : res.statusText);
      throw new WorkerApiError(res.status, path, `${method} ${path}: ${res.status} ${detail}`);
    }
    return (parsed ?? {}) as T;
  }
}
