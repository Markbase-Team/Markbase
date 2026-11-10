import { NextResponse } from "next/server";
import os from "node:os";
import path from "node:path";
import { listWorkerRepos, requestRepoRescan } from "@markbase/protocol/worker-repos";
import { authenticateAgent } from "@/lib/agent-auth";

export const runtime = "nodejs";

const home = os.homedir();

// A readable label for a discovered repo: prefer "owner/repo" when there's a
// remote, otherwise the path relative to home (so nested folders that share a
// basename stay distinguishable).
function labelFor(cwd: string, remote: string | null): string {
  if (remote) return remote;
  return path.relative(home, cwd) || cwd;
}

// GET /api/v1/repos — the local repos this owner's worker discovered from
// Claude's session history (see worker_repos / discover-repos). Replaces the old
// filesystem walk, which only worked when the web app ran on the user's own
// machine and missed non-git folders. Powers the project local_path picker.
//
// Keeps `name`/`path` for the existing picker and adds `status`/`remote`/
// `branch` so the UI can badge git-aware vs. plain folders.
export async function GET(req: Request) {
  const auth = await authenticateAgent(req, "read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const discovered = await listWorkerRepos(auth.ownerId);
  const repos = discovered.map((r) => ({
    name: labelFor(r.cwd, r.remote),
    path: r.cwd,
    status: r.status,
    remote: r.remote,
    branch: r.branch,
  }));

  return NextResponse.json({ repos });
}

// POST /api/v1/repos — ask this owner's worker to re-scan its local repos now.
// The worker picks the request up on its next idle poll (~3s) and reports the
// fresh set, which the client then re-fetches via GET.
export async function POST(req: Request) {
  const auth = await authenticateAgent(req, "write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  await requestRepoRescan(auth.ownerId);
  return NextResponse.json({ ok: true });
}
