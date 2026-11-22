import { describe, it, expect, vi, beforeEach } from "vitest";

// The worker's endpoints scope everything by the owner the KEY resolves to.
// Nothing in a request body or path may widen that: another owner's job,
// ticket, request or project is not found, and the owner the server passes
// to the data layer is always the caller's. The data layer is mocked at the
// seam the handlers call it through; what is under test is who gets what.

const jobs = {
  claimNextJob: vi.fn(),
  finishJob: vi.fn(),
  getOwnedJob: vi.fn(),
  heartbeatJob: vi.fn(),
  reclaimStale: vi.fn(),
};
const sessions = {
  claimMessageRequest: vi.fn(),
  claimSpawnRequest: vi.fn(),
  finishMessageRequest: vi.fn(),
  finishSpawnRequest: vi.fn(),
  getAgentSessionById: vi.fn(),
  listQueuedAgentRequests: vi.fn(),
  setAgentSessionExternalId: vi.fn(),
  listAgentSessions: vi.fn(),
};
const tickets = {
  getProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  getTicket: vi.fn(),
  updateTicket: vi.fn(),
  updateTicketCc: vi.fn(),
  addMessage: vi.fn(),
  listMessages: vi.fn(),
  listProjectProperties: vi.fn(),
};
const plans = { getUserPlan: vi.fn() };
const repos = {
  reportWorkerRepos: vi.fn(),
  reportWorkerSessions: vi.fn(),
  takeRepoRescan: vi.fn(),
};
const keys = { setClaudeVersion: vi.fn() };
const refresh = {
  requestRefresh: vi.fn(),
  listRefreshRequests: vi.fn(),
  clearRefreshRequest: vi.fn(),
  saveProjectBranches: vi.fn(),
  clearProjectBranches: vi.fn(),
};

vi.mock("@markbase/server/db/jobs", () => jobs);
vi.mock("@markbase/server/db/agent-sessions", () => sessions);
vi.mock("@markbase/server/db/tickets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/server/db/tickets")>()),
  ...tickets,
}));
vi.mock("@markbase/server/db/plans", () => plans);
vi.mock("@markbase/server/db/worker-repos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/server/db/worker-repos")>()),
  ...repos,
}));
vi.mock("@markbase/server/db/worker-refresh", () => refresh);
vi.mock("@markbase/server/api-keys", () => keys);
vi.mock("@markbase/server/features", () => ({
  CLAUDE_CODE_REQUIRED: "needs claude",
  featureEnabled: async () => true,
}));

const handlers = await import("../src/handlers/worker");
const { ticketHandler, ticketMessagesHandler } = await import("../src/handlers/tickets");
const { projectHandler, projectsHandler, projectBranchesHandler } = await import(
  "../src/handlers/projects"
);
const { ticketPreviewHandler, ticketReviewHandler } = await import("../src/handlers/runs");
type HandlerHost = import("../src/handlers/host").HandlerHost;
type Authenticated = import("../src/handlers/host").Authenticated;

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const TICKET = "33333333-3333-4333-8333-333333333333";

/** A's key, A's session, B's key — picked by a test header; the real gate is not under test. */
const CALLERS: Record<string, Authenticated> = {
  "a-key": { ok: true, ownerId: A, keyId: "key_a" },
  "a-session": { ok: true, ownerId: A, keyId: null },
  "b-key": { ok: true, ownerId: B, keyId: "key_b" },
};

const host: HandlerHost = {
  authenticate: async (req) => {
    const who = req.headers.get("x-test-caller");
    const refused: Authenticated = { ok: false, status: 401, error: "Invalid API key." };
    return who ? (CALLERS[who] ?? refused) : refused;
  },
  json: (data, status = 200) => Response.json(data, { status }),
};

function req(
  who: string | null,
  init: { method?: string; body?: object; path?: string } = {}
): Request {
  const headers: Record<string, string> = {};
  if (who) headers["x-test-caller"] = who;
  if (init.body) headers["content-type"] = "application/json";
  return new Request(`https://markbase.so/api/v1${init.path ?? "/worker/claim"}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

const A_JOB = { id: JOB, ticket_id: TICKET, owner_id: A, kind: "dispatch", status: "running" };
const A_TICKET = { id: TICKET, project: "p", owner_id: A, title: "T", properties: {} };

beforeEach(() => {
  for (const group of [jobs, sessions, tickets, plans, repos, keys, refresh]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
  // The data layer is owner-scoped: it answers A's things to A and nothing to B.
  jobs.getOwnedJob.mockImplementation(async (owner: string, id: string) =>
    owner === A && id === JOB ? A_JOB : null
  );
  tickets.getTicket.mockImplementation(async (id: string, owner: string) =>
    owner === A && id === TICKET ? A_TICKET : undefined
  );
  tickets.getProject.mockImplementation(async (slug: string, owner: string) =>
    owner === A && slug === "p" ? { slug: "p", name: "P", local_path: "/repo", owner_id: A } : undefined
  );
  tickets.listProjectProperties.mockResolvedValue([]);
  jobs.claimNextJob.mockResolvedValue(null);
  repos.takeRepoRescan.mockResolvedValue(false);
  refresh.listRefreshRequests.mockResolvedValue({ tickets: [], projects: [] });
  plans.getUserPlan.mockResolvedValue("pro");
});

describe("POST /worker/claim", () => {
  it("claims for the key's owner, whatever the body says", async () => {
    jobs.claimNextJob.mockResolvedValue(A_JOB);
    const res = await handlers.workerClaimHandler(host)(
      req("a-key", { body: { version: "0.8.0", owner_id: B, p_owner_id: B } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      job: A_JOB,
      rescan: false,
      refresh: { tickets: [], projects: [] },
    });
    expect(jobs.claimNextJob).toHaveBeenCalledWith(A, "0.8.0");
    expect(jobs.reclaimStale).not.toHaveBeenCalled();
    // A worker with a job is about to be busy: nothing else is handed to it.
    expect(refresh.listRefreshRequests).not.toHaveBeenCalled();
  });

  it("runs the staleness sweep first only when asked, and takes a rescan only when idle", async () => {
    repos.takeRepoRescan.mockResolvedValue(true);
    const res = await handlers.workerClaimHandler(host)(req("a-key", { body: { reclaim: true } }));
    expect(await res.json()).toEqual({
      job: null,
      rescan: true,
      refresh: { tickets: [], projects: [] },
    });
    expect(jobs.reclaimStale).toHaveBeenCalledTimes(1);
    expect(repos.takeRepoRescan).toHaveBeenCalledWith(A);
  });

  it("hands an idle worker its owner's pending refresh requests", async () => {
    refresh.listRefreshRequests.mockResolvedValue({ tickets: [TICKET], projects: ["p"] });
    const res = await handlers.workerClaimHandler(host)(req("a-key", { body: {} }));
    expect((await res.json()).refresh).toEqual({ tickets: [TICKET], projects: ["p"] });
    expect(refresh.listRefreshRequests).toHaveBeenCalledWith(A);
  });

  it("refuses a caller the gate refused", async () => {
    const res = await handlers.workerClaimHandler(host)(req(null, { body: {} }));
    expect(res.status).toBe(401);
    expect(jobs.claimNextJob).not.toHaveBeenCalled();
  });
});

describe("jobs: heartbeat, read, finish", () => {
  it("B's key cannot heartbeat, read or finish A's job", async () => {
    const hb = await handlers.workerHeartbeatHandler(host)(req("b-key", { body: { jobId: JOB } }));
    expect(hb.status).toBe(404);
    const rd = await handlers.workerJobHandler(host).GET(req("b-key"), JOB);
    expect(rd.status).toBe(404);
    const fin = await handlers.workerJobFinishHandler(host)(
      req("b-key", { body: { status: "done" } }),
      JOB
    );
    expect(fin.status).toBe(404);
    expect(jobs.heartbeatJob).not.toHaveBeenCalled();
    expect(jobs.finishJob).not.toHaveBeenCalled();
    expect(tickets.updateTicketCc).not.toHaveBeenCalled();
  });

  it("A's key heartbeats its job and the job's own ticket", async () => {
    const res = await handlers.workerHeartbeatHandler(host)(
      req("a-key", { body: { jobId: JOB, ticketId: "someone-elses" } })
    );
    expect(res.status).toBe(200);
    expect(jobs.heartbeatJob).toHaveBeenCalledWith(JOB);
    expect(tickets.updateTicketCc).toHaveBeenCalledWith(
      TICKET,
      expect.objectContaining({ cc_last_run: expect.any(String) })
    );
  });

  it("A's key reads and finishes its job", async () => {
    const rd = await handlers.workerJobHandler(host).GET(req("a-key"), JOB);
    expect(await rd.json()).toEqual({ job: A_JOB });
    const fin = await handlers.workerJobFinishHandler(host)(
      req("a-key", { body: { status: "error", error: "boom" } }),
      JOB
    );
    expect(fin.status).toBe(200);
    expect(jobs.finishJob).toHaveBeenCalledWith(JOB, "error", "boom");
  });

  it("refuses a malformed finish and a malformed heartbeat", async () => {
    const fin = await handlers.workerJobFinishHandler(host)(
      req("a-key", { body: { status: "maybe" } }),
      JOB
    );
    expect(fin.status).toBe(400);
    const hb = await handlers.workerHeartbeatHandler(host)(req("a-key", { body: { jobId: "nope" } }));
    expect(hb.status).toBe(400);
  });
});

describe("discovery", () => {
  it("reports repos for the key's owner, dropping malformed entries", async () => {
    const res = await handlers.workerReposHandler(host)(
      req("a-key", {
        body: {
          repos: [
            { cwd: "/a", remote: "o/r", branch: "main", status: "ready", lastActive: "2026-10-29T00:00:00Z" },
            { cwd: "/b", status: "weird", lastActive: "2026-10-29T00:00:00Z" },
            { cwd: "", status: "ready", lastActive: "2026-10-29T00:00:00Z" },
            { cwd: "/c", status: "no-remote", lastActive: "not a date" },
          ],
        },
      })
    );
    expect(await res.json()).toEqual({ ok: true, count: 1 });
    expect(repos.reportWorkerRepos).toHaveBeenCalledWith(A, [
      { cwd: "/a", remote: "o/r", branch: "main", status: "ready", lastActive: "2026-10-29T00:00:00Z" },
    ]);
  });

  it("attributes sessions to the key that reported them, not to anything in the body", async () => {
    const res = await handlers.workerSessionsHandler(host)(
      req("a-key", {
        body: {
          connectionId: "forged",
          sessions: [{ sessionId: "s1", repoCwd: "/a", title: null, lastActive: "2026-10-29T00:00:00Z" }],
        },
      })
    );
    expect(res.status).toBe(200);
    expect(repos.reportWorkerSessions).toHaveBeenCalledWith(
      A,
      [{ sessionId: "s1", repoCwd: "/a", title: null, lastActive: "2026-10-29T00:00:00Z" }],
      "key_a"
    );
  });

  it("a session caller reports sessions unattributed", async () => {
    await handlers.workerSessionsHandler(host)(req("a-session", { body: { sessions: [] } }));
    expect(repos.reportWorkerSessions).toHaveBeenCalledWith(A, [], null);
  });

  it("refuses a body that is not a list", async () => {
    const res = await handlers.workerReposHandler(host)(req("a-key", { body: { repos: "x" } }));
    expect(res.status).toBe(400);
  });
});

describe("agent requests", () => {
  const SPAWN = { id: REQ, owner_id: A, agent_session_id: "as1", project: "p", prompt: "hi", status: "running" };

  it("lists the key's owner's queue", async () => {
    sessions.listQueuedAgentRequests.mockResolvedValue({ spawn: [SPAWN], message: [] });
    const res = await handlers.workerAgentRequestsHandler(host)(req("a-key"));
    expect(await res.json()).toEqual({ spawn: [SPAWN], message: [] });
    expect(sessions.listQueuedAgentRequests).toHaveBeenCalledWith(A);
  });

  it("claiming a spawn binds a fresh session id to the slot and hands back the project", async () => {
    sessions.claimSpawnRequest.mockImplementation(async (owner: string, id: string) =>
      owner === A && id === REQ ? SPAWN : null
    );
    const res = await handlers.workerAgentRequestClaimHandler(host)(
      req("a-key", { body: { kind: "spawn" } }),
      REQ
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("spawn");
    expect(body.request).toEqual(SPAWN);
    expect(body.project).toEqual({ slug: "p", name: "P", local_path: "/repo" });
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessions.setAgentSessionExternalId).toHaveBeenCalledWith({
      ownerId: A,
      agentSessionId: "as1",
      externalSessionId: body.sessionId,
      repoCwd: "/repo",
    });
  });

  it("B's key cannot claim or finish A's request", async () => {
    sessions.claimSpawnRequest.mockResolvedValue(null);
    sessions.finishSpawnRequest.mockResolvedValue(false);
    const claim = await handlers.workerAgentRequestClaimHandler(host)(
      req("b-key", { body: { kind: "spawn" } }),
      REQ
    );
    expect(claim.status).toBe(409);
    expect(sessions.claimSpawnRequest).toHaveBeenCalledWith(B, REQ);
    expect(sessions.setAgentSessionExternalId).not.toHaveBeenCalled();
    const fin = await handlers.workerAgentRequestFinishHandler(host)(
      req("b-key", { body: { kind: "spawn", status: "done" } }),
      REQ
    );
    expect(fin.status).toBe(404);
    expect(sessions.finishSpawnRequest).toHaveBeenCalledWith(B, REQ, "done", undefined);
  });

  it("claiming a message hands back the session to resume, token included", async () => {
    const MSG = { id: REQ, owner_id: A, agent_session_id: "as1", prompt: "@ada hi", status: "running" };
    sessions.claimMessageRequest.mockResolvedValue(MSG);
    sessions.getAgentSessionById.mockResolvedValue({
      id: "as1",
      owner_id: A,
      external_session_id: "ext1",
      status: "active",
      context: { repo_cwd: "/repo" },
      session_token: "sess_tok",
      name: "Ada",
    });
    const res = await handlers.workerAgentRequestClaimHandler(host)(
      req("a-key", { body: { kind: "message" } }),
      REQ
    );
    const body = await res.json();
    expect(body.kind).toBe("message");
    expect(body.session).toEqual({
      id: "as1",
      external_session_id: "ext1",
      status: "active",
      context: { repo_cwd: "/repo" },
      session_token: "sess_tok",
    });
    expect(sessions.getAgentSessionById).toHaveBeenCalledWith(A, "as1");
  });

  it("refuses an unknown kind", async () => {
    const res = await handlers.workerAgentRequestClaimHandler(host)(
      req("a-key", { body: { kind: "other" } }),
      REQ
    );
    expect(res.status).toBe(400);
  });
});

describe("PATCH /worker/claude-version", () => {
  it("records the version on the calling key, for its owner", async () => {
    const res = await handlers.workerClaudeVersionHandler(host)(
      req("a-key", { method: "PATCH", body: { version: "2.1.0" } })
    );
    expect(res.status).toBe(200);
    expect(keys.setClaudeVersion).toHaveBeenCalledWith("key_a", A, "2.1.0");
  });

  it("a browser session has no key to record it on", async () => {
    const res = await handlers.workerClaudeVersionHandler(host)(
      req("a-session", { method: "PATCH", body: { version: "2.1.0" } })
    );
    expect(res.status).toBe(400);
    expect(keys.setClaudeVersion).not.toHaveBeenCalled();
  });
});

describe("GET /me/plan", () => {
  it("answers the caller's plan", async () => {
    const res = await handlers.myPlanHandler(host)(req("a-key"));
    expect(await res.json()).toEqual({ plan: "pro" });
    expect(plans.getUserPlan).toHaveBeenCalledWith(A);
  });
});

describe("tickets and projects, as the worker uses them", () => {
  it("B's key cannot read, patch or post into A's ticket", async () => {
    const h = ticketHandler(host);
    expect((await h.GET(req("b-key"), TICKET)).status).toBe(404);
    expect(
      (await h.PATCH(req("b-key", { method: "PATCH", body: { cc_state: "done" } }), TICKET)).status
    ).toBe(404);
    const m = ticketMessagesHandler(host);
    expect((await m.POST(req("b-key", { body: { content: "hi" } }), TICKET)).status).toBe(404);
    expect(tickets.updateTicketCc).not.toHaveBeenCalled();
    expect(tickets.addMessage).not.toHaveBeenCalled();
  });

  it("A's key reports progress through PATCH, validated field by field", async () => {
    tickets.updateTicket.mockResolvedValue(A_TICKET);
    const res = await ticketHandler(host).PATCH(
      req("a-key", {
        method: "PATCH",
        body: {
          cc_state: "done",
          cc_summary: "did it",
          pr_url: "https://github.com/o/r/pull/1",
          commits: [{ title: "fix", link: null }, { nope: true }],
          owner_id: B,
        },
      }),
      TICKET
    );
    expect(res.status).toBe(200);
    expect(tickets.updateTicketCc).toHaveBeenCalledWith(TICKET, {
      cc_state: "done",
      cc_summary: "did it",
      pr_url: "https://github.com/o/r/pull/1",
      commits: [{ title: "fix", link: null }],
    });
  });

  it("an invalid cc_state is refused, and nothing is written", async () => {
    const res = await ticketHandler(host).PATCH(
      req("a-key", { method: "PATCH", body: { cc_state: "exploded" } }),
      TICKET
    );
    expect(res.status).toBe(400);
    expect(tickets.updateTicketCc).not.toHaveBeenCalled();
  });

  it("A's key posts the run's reply into its own thread", async () => {
    const res = await ticketMessagesHandler(host).POST(
      req("a-key", { body: { content: "  done  " } }),
      TICKET
    );
    expect(res.status).toBe(201);
    expect(tickets.addMessage).toHaveBeenCalledWith(TICKET, "assistant", "done");
  });

  it("an empty message or a made-up role is refused", async () => {
    const m = ticketMessagesHandler(host);
    expect((await m.POST(req("a-key", { body: { content: "" } }), TICKET)).status).toBe(400);
    expect((await m.POST(req("a-key", { body: { content: "x", role: "system" } }), TICKET)).status).toBe(400);
  });

  it("A's key reads its project; B's key finds nothing", async () => {
    const h = projectHandler(host);
    const mine = await h.GET(req("a-key"), "p");
    expect(mine.status).toBe(200);
    expect((await mine.json()).project.local_path).toBe("/repo");
    expect((await h.GET(req("b-key"), "p")).status).toBe(404);
  });
});

// The web server has no checkout, so it never runs git. A route that needs the
// repo records a request for the owner's worker and the worker's report is
// what writes the answer.
describe("refresh: the server asks, the worker answers", () => {
  it("preview and review only queue a request for the ticket's owner", async () => {
    for (const handler of [ticketPreviewHandler(host), ticketReviewHandler(host)]) {
      const res = await handler(req("a-session", { method: "POST" }), TICKET);
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ queued: true });
    }
    expect(refresh.requestRefresh).toHaveBeenCalledTimes(2);
    expect(refresh.requestRefresh).toHaveBeenCalledWith(A, "ticket", TICKET);
    expect(tickets.updateTicketCc).not.toHaveBeenCalled();
  });

  it("B cannot queue a refresh of A's ticket", async () => {
    const res = await ticketPreviewHandler(host)(req("b-key", { method: "POST" }), TICKET);
    expect(res.status).toBe(404);
    expect(refresh.requestRefresh).not.toHaveBeenCalled();
  });

  it("a ticket report writes what was found, moves a pending review, and clears the request", async () => {
    const res = await handlers.workerTicketSyncHandler(host)(
      req("a-key", {
        body: {
          commits: [{ title: "fix", link: "https://github.com/o/r/commit/abc" }],
          pr_id: "12",
          pr_title: "Fix it",
          pr_url: "https://github.com/o/r/pull/12",
          review_requested: true,
          preview_url: "https://preview.example",
          status: "done",
          owner_id: B,
        },
      }),
      TICKET
    );
    expect(res.status).toBe(200);
    expect(tickets.updateTicketCc).toHaveBeenCalledWith(TICKET, {
      commits: [{ title: "fix", link: "https://github.com/o/r/commit/abc" }],
      pr_id: "12",
      pr_title: "Fix it",
      pr_url: "https://github.com/o/r/pull/12",
      preview_url: "https://preview.example",
    });
    expect(tickets.updateTicket).toHaveBeenCalledWith(TICKET, { status: "review_requested" }, A);
    expect(refresh.clearRefreshRequest).toHaveBeenCalledWith(A, "ticket", TICKET);
  });

  it("a report that found no PR and no preview leaves those fields and the status alone", async () => {
    await handlers.workerTicketSyncHandler(host)(
      req("a-key", { body: { commits: [], review_requested: true } }),
      TICKET
    );
    expect(tickets.updateTicketCc).toHaveBeenCalledWith(TICKET, { commits: [] });
    expect(tickets.updateTicket).not.toHaveBeenCalled();
  });

  it("B's key cannot report on A's ticket or A's project", async () => {
    const t = await handlers.workerTicketSyncHandler(host)(
      req("b-key", { body: { commits: [] } }),
      TICKET
    );
    expect(t.status).toBe(404);
    const p = await handlers.workerProjectRepoHandler(host)(
      req("b-key", { body: { branches: ["main"] } }),
      "p"
    );
    expect(p.status).toBe(404);
    expect(tickets.updateTicketCc).not.toHaveBeenCalled();
    expect(refresh.saveProjectBranches).not.toHaveBeenCalled();
  });

  it("a project report stores the branches and fills an empty GitHub link from the remote", async () => {
    const res = await handlers.workerProjectRepoHandler(host)(
      req("a-key", {
        body: {
          branches: ["main", "dev", "main", ""],
          default: "main",
          current: "dev",
          remote: "git@github.com:o/r.git",
        },
      }),
      "p"
    );
    expect(res.status).toBe(200);
    expect(refresh.saveProjectBranches).toHaveBeenCalledWith(A, "p", {
      branches: ["main", "dev"],
      default: "main",
      current: "dev",
      remote: "git@github.com:o/r.git",
    });
    expect(tickets.updateProject).toHaveBeenCalledWith(
      "p",
      { github_repo: "https://github.com/o/r" },
      A
    );
    expect(refresh.clearRefreshRequest).toHaveBeenCalledWith(A, "project", "p");
  });

  it("a project report never overwrites a GitHub link someone set", async () => {
    tickets.getProject.mockResolvedValue({
      slug: "p",
      name: "P",
      local_path: "/repo",
      owner_id: A,
      github_repo: "https://github.com/typed/link",
    });
    await handlers.workerProjectRepoHandler(host)(
      req("a-key", { body: { branches: ["main"], remote: "git@github.com:o/r.git" } }),
      "p"
    );
    expect(tickets.updateProject).not.toHaveBeenCalled();
  });

  it("a project report without a branch list is refused", async () => {
    const res = await handlers.workerProjectRepoHandler(host)(
      req("a-key", { body: { remote: "x" } }),
      "p"
    );
    expect(res.status).toBe(400);
    expect(refresh.saveProjectBranches).not.toHaveBeenCalled();
  });

  it("branches are the worker's last report, and reading them asks for a fresh one", async () => {
    tickets.getProject.mockResolvedValue({
      slug: "p",
      name: "P",
      local_path: "/repo",
      owner_id: A,
      branches: { branches: ["main"], default: "main", current: "main", at: "2026-11-22T00:00:00Z" },
    });
    const res = await projectBranchesHandler(host)(req("a-session"), "p");
    expect(await res.json()).toEqual({
      branches: ["main"],
      default: "main",
      current: "main",
      at: "2026-11-22T00:00:00Z",
      refreshing: true,
    });
    expect(refresh.requestRefresh).toHaveBeenCalledWith(A, "project", "p");
  });

  it("branches before any worker has answered are empty, not an error", async () => {
    const res = await projectBranchesHandler(host)(req("a-session"), "p");
    expect(await res.json()).toEqual({
      branches: [],
      default: null,
      current: null,
      at: null,
      refreshing: true,
    });
  });

  it("creating a project checks only the path's form, and asks the worker to read the repo", async () => {
    tickets.getProject.mockResolvedValue(undefined);
    tickets.createProject.mockImplementation(async (input: { slug: string }) => input);
    const relative = await projectsHandler(host).POST(
      req("a-session", { body: { slug: "new", name: "New", local_path: "repos/new" } })
    );
    expect(relative.status).toBe(400);

    // A path that does not exist on the server is fine: it is the worker's disk.
    const res = await projectsHandler(host).POST(
      req("a-session", {
        body: { slug: "new", name: "New", local_path: "/not/on/this/server" },
      })
    );
    expect(res.status).toBe(201);
    // No link typed: it stays empty until the worker reports the remote.
    expect(tickets.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ local_path: "/not/on/this/server", github_repo: null })
    );
    expect(refresh.requestRefresh).toHaveBeenCalledWith(A, "project", "new");
  });

  it("changing a project's path drops its stored branches and asks for new ones", async () => {
    await projectHandler(host).PATCH(
      req("a-session", { method: "PATCH", body: { local_path: "/other" } }),
      "p"
    );
    expect(refresh.clearProjectBranches).toHaveBeenCalledWith(A, "p");
    expect(refresh.requestRefresh).toHaveBeenCalledWith(A, "project", "p");
  });
});
