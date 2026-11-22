import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The web server has no checkout, so it asks: an idle claim carries the
// tickets and projects it wants looked up, and the worker answers from the
// repo on this machine. This runs the real worker against a stand-in server
// and a real git repo, because what is under test is that the answer comes
// from the disk here and reaches the right endpoint.

process.env.MARKBASE_HOME = mkdtempSync(join(tmpdir(), "mb-refresh-"));
const { runTicketWorker } = await import("../../src/runner/run-ticket-worker");

const repo = mkdtempSync(join(tmpdir(), "mb-refresh-repo-"));
const git = (...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
git("init", "-q", "-b", "main");
git("config", "user.email", "test@example.com");
git("config", "user.name", "Test");
writeFileSync(join(repo, "a.txt"), "a\n");
git("add", ".");
git("commit", "-q", "-m", "first");
git("branch", "feature/one");
git("remote", "add", "origin", "git@github.com:acme/widgets.git");

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

interface Posted {
  path: string;
  body: { branches?: string[]; current?: string | null; remote?: string | null; commits?: object[] };
}

async function readBody(req: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of req) text += String(chunk);
  return text;
}

/** A stand-in web app: one refresh request on the first claim, then nothing. */
async function app(
  projects: Record<string, { local_path: string | null }>,
  refresh: { tickets: string[]; projects: string[] },
  onPost: (p: Posted) => void
): Promise<{ url: string; server: Server }> {
  let offered = false;
  const server = createServer(async (req, res) => {
    const path = (req.url ?? "").replace(/^\/api\/v1/, "");
    const send = (status: number, body: object): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const text = req.method === "GET" ? "" : await readBody(req);
    if (path === "/me") return send(200, { owner_id: "o1", connection_id: "c1" });
    if (path === "/worker/claim") {
      const first = !offered;
      offered = true;
      return send(200, {
        job: null,
        rescan: false,
        refresh: first ? refresh : { tickets: [], projects: [] },
      });
    }
    if (path === "/worker/agent-requests") return send(200, { spawn: [], message: [] });
    const project = path.match(/^\/projects\/([^/]+)$/);
    if (project) {
      const found = projects[decodeURIComponent(project[1])];
      return found
        ? send(200, { project: { slug: project[1], name: project[1], ...found } })
        : send(404, { error: "Project not found" });
    }
    if (req.method === "POST" && /^\/worker\/(projects|tickets)\//.test(path)) {
      onPost({ path, body: JSON.parse(text) });
      return send(200, { ok: true });
    }
    return send(200, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return { url: `http://127.0.0.1:${addr.port}`, server };
}

/** Run the worker until `done` says it has seen enough, or two seconds pass. */
async function runUntil(url: string, done: () => boolean, lines: string[]): Promise<void> {
  const ac = new AbortController();
  const run = runTicketWorker({
    appUrl: url,
    apiKey: "jsk_test",
    pollMs: 20,
    signal: ac.signal,
    checkForUpdates: false,
    lockOwner: "test",
    log: (m) => lines.push(m),
  });
  const started = Date.now();
  while (!done() && Date.now() - started < 2_000) {
    await new Promise((r) => setTimeout(r, 20));
  }
  ac.abort();
  await run;
}

describe("the worker answers refresh requests from its own disk", () => {
  it("reports a project's branches and remote, read from the local repo", async () => {
    const posted: Posted[] = [];
    const { url, server } = await app(
      { widgets: { local_path: repo } },
      { tickets: [], projects: ["widgets"] },
      (p) => posted.push(p)
    );
    const lines: string[] = [];
    try {
      await runUntil(url, () => posted.length > 0, lines);
    } finally {
      server.close();
    }
    expect(posted).toHaveLength(1);
    expect(posted[0].path).toBe("/worker/projects/widgets/repo");
    expect(posted[0].body.branches).toEqual(["main", "feature/one"]);
    expect(posted[0].body.current).toBe("main");
    expect(posted[0].body.remote).toBe("git@github.com:acme/widgets.git");
  });

  it("leaves a project whose path is not on this machine for another worker", async () => {
    const posted: Posted[] = [];
    let claims = 0;
    const { url, server } = await app(
      { elsewhere: { local_path: "/no/such/folder/on/this/machine" } },
      { tickets: [], projects: ["elsewhere"] },
      (p) => posted.push(p)
    );
    server.on("request", (req) => {
      if ((req.url ?? "").endsWith("/worker/claim")) claims++;
    });
    const lines: string[] = [];
    try {
      await runUntil(url, () => claims >= 3, lines);
    } finally {
      server.close();
    }
    expect(posted).toEqual([]);
    // Not an error either: it is simply not this worker's to answer.
    expect(lines.filter((l) => l.includes("refresh error"))).toEqual([]);
  });
});
